import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack,
  StackProps,
  CfnOutput,
  CfnResource,
  RemovalPolicy,
  Duration,
  Tags,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import type { SeedConfig } from './config.js';

interface CwlQueryDef {
  description: string;
  defaultHours: number;
  query: string;
}

interface CwlQueriesConfig {
  logGroup: string;
  queries: Record<string, CwlQueryDef>;
}

export interface DailyOrbitStackProps extends StackProps {
  config: SeedConfig;
}

export class DailyOrbitStack extends Stack {
  constructor(scope: Construct, id: string, props: DailyOrbitStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Apply tags to all resources
    for (const [key, value] of Object.entries(config.tags)) {
      Tags.of(this).add(key, value);
    }

    // ── 5a. Networking ─────────────────────────────────────────────────────
    const vpc: ec2.IVpc = config.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 2,
          natGateways: 1,
        });

    const securityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(this, 'InstanceSg', {
      vpc,
      description: 'Daily Orbit instance security group',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP redirect');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9000), 'App HTTP (dev)');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH');

    const eip: ec2.CfnEIP = new ec2.CfnEIP(this, 'Eip', {
      tags: [{ key: 'Name', value: `${config.stackName}-eip` }],
    });

    // ── 5b. DNS ────────────────────────────────────────────────────────────
    const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: config.domainName,
    });

    // API subdomain → Elastic IP
    new route53.ARecord(this, 'ApiRecord', {
      zone: hostedZone,
      recordName: config.apiDomainName,
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
    });

    // ── 5d. Storage ──────────────────────────────────────────────────────
    // Import the existing S3 bucket (created outside CDK)
    const snapshotBucket: s3.IBucket = s3.Bucket.fromBucketName(
      this, 'SnapshotBucket', config.dbSnapshotBucket,
    );

    // ── 5e. Container Registry ───────────────────────────────────────────
    const ecrRepo: ecr.Repository = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: config.ecrRepositoryName,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Expire untagged images after 7 days',
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(7),
        },
      ],
    });

    // ── 5f. IAM ──────────────────────────────────────────────────────────
    const instanceRole: iam.Role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Daily Orbit EC2 instance role',
    });

    // ECR pull
    ecrRepo.grantPull(instanceRole);

    // S3 snapshot bucket
    snapshotBucket.grantReadWrite(instanceRole);

    // EC2 EIP association
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AssociateAddress'],
        resources: ['*'],
      }),
    );

    // Bedrock for AI features
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:Converse', 'bedrock:ConverseStream'],
        resources: ['*'],
      }),
    );

    // SES for alerts
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    // CloudWatch Logs for structured log shipping
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
          'logs:StartQuery',
          'logs:GetQueryResults',
        ],
        resources: ['*'],
      }),
    );

    // ── 5g. Compute ──────────────────────────────────────────────────────
    const __dirname: string = dirname(fileURLToPath(import.meta.url));
    const userDataRaw: string = readFileSync(resolve(__dirname, 'user-data.sh'), 'utf-8');

    const ecrUri: string = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${config.ecrRepositoryName}`;

    const userDataRendered: string = userDataRaw
      .replaceAll('{{EIP_ALLOCATION_ID}}', eip.attrAllocationId)
      .replaceAll('{{DB_SNAPSHOT_BUCKET}}', config.dbSnapshotBucket)
      .replaceAll('{{REGION}}', this.region)
      .replaceAll('{{ECR_URI}}', ecrUri)
      .replaceAll('{{CONTAINER_TAG}}', config.containerTag);

    const userData: ec2.UserData = ec2.UserData.custom(userDataRendered);

    const launchTemplate: ec2.LaunchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
      ),
      instanceType: new ec2.InstanceType(config.instanceType),
      role: instanceRole,
      userData,
      securityGroup,
      requireImdsv2: true,
      keyPair: config.keyPairName
        ? ec2.KeyPair.fromKeyPairName(this, 'KeyPair', config.keyPairName)
        : undefined,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      mixedInstancesPolicy: {
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: 0,
          spotAllocationStrategy: autoscaling.SpotAllocationStrategy.PRICE_CAPACITY_OPTIMIZED,
        },
        launchTemplate,
      },
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      defaultInstanceWarmup: Duration.seconds(300),
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: Duration.seconds(300),
      }),
    });

    // ── 6. CloudFront (frontend) ───────────────────────────────────────
    const frontendBucket: s3.Bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${config.stackName}-frontend`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // EC2 needs write access for newspaper image uploads
    frontendBucket.grantReadWrite(instanceRole);

    const cloudfrontCert: acm.ICertificate = acm.Certificate.fromCertificateArn(
      this, 'CloudFrontCert', config.cloudfrontCertificateArn,
    );

    // CloudFront Function: SPA routing on the default behavior.
    // Rewrites non-file paths to /index.html so client-side routing works.
    // This replaces distribution-level errorResponses, which cannot be
    // scoped per-behavior and were silently masking missing images.
    const spaRoutingFn = new cloudfront.Function(this, 'SpaRoutingFn', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var uri = event.request.uri;
  if (uri.match(/\\.[a-zA-Z0-9]+$/)) {
    return event.request;
  }
  event.request.uri = '/index.html';
  return event.request;
}
      `.trim()),
    });

    const distribution: cloudfront.Distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function: spaRoutingFn,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        'newspaper/images/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
      domainNames: [config.domainName],
      certificate: cloudfrontCert,
      defaultRootObject: 'index.html',
    });

    // dailyorbit.org → CloudFront
    new route53.ARecord(this, 'ApexRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new route53.ARecord(this, 'WwwRecord', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // ── 5i. CloudWatch Logs Insights Saved Queries ────────────────────────
    // Reads query definitions from the shared cwl-queries.json used by both
    // the CLI tool (cwl-query.py) and these saved queries in the Console.
    const cwlQueriesPath: string = resolve(__dirname, '../../packages/server/debugscripts/cwl-queries.json');
    const cwlQueries: CwlQueriesConfig = JSON.parse(readFileSync(cwlQueriesPath, 'utf-8'));

    for (const [name, qdef] of Object.entries(cwlQueries.queries)) {
      // Skip parameterized queries — they need runtime args, not useful as saved queries
      if (qdef.query.includes('{arg}')) continue;

      new CfnResource(this, `CwlQuery-${name}`, {
        type: 'AWS::Logs::QueryDefinition',
        properties: {
          Name: `daily-orbit - ${name}`,
          QueryString: qdef.query,
          LogGroupNames: [cwlQueries.logGroup],
        },
      });
    }

    // ── 5h. Outputs ──────────────────────────────────────────────────────
    new CfnOutput(this, 'ElasticIpAddress', {
      value: eip.ref,
      description: 'Elastic IP address',
    });

    new CfnOutput(this, 'ApiUrl', {
      value: `https://${config.apiDomainName}`,
      description: 'API URL',
    });

    new CfnOutput(this, 'EcrRepositoryUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR repository URI',
    });

    new CfnOutput(this, 'SnapshotBucketName', {
      value: snapshotBucket.bucketName,
      description: 'S3 snapshot bucket name',
    });

    new CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for frontend static assets',
    });

    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
    });

    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${config.domainName}`,
      description: 'Frontend URL',
    });
  }
}
