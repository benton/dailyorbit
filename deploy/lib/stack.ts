import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  Duration,
  Tags,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import type { SeedConfig } from './config.js';

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

    const eip: ec2.CfnEIP = new ec2.CfnEIP(this, 'Eip', {
      tags: [{ key: 'Name', value: `${config.stackName}-eip` }],
    });

    // ── 5b. DNS ────────────────────────────────────────────────────────────
    const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: config.domainName,
    });

    new route53.ARecord(this, 'ApexRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
    });

    new route53.ARecord(this, 'WwwRecord', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
    });

    // ── 5c. Secrets ────────────────────────────────────────────────────────
    const tlsCertSecret: secretsmanager.Secret = new secretsmanager.Secret(this, 'TlsCert', {
      secretName: 'daily-orbit/tls-cert',
      description: 'TLS certificate chain (PEM) for daily-orbit HTTPS termination',
    });

    const tlsKeySecret: secretsmanager.Secret = new secretsmanager.Secret(this, 'TlsKey', {
      secretName: 'daily-orbit/tls-key',
      description: 'TLS private key (PEM) for daily-orbit HTTPS termination',
    });

    // ── 5d. Storage ────────────────────────────────────────────────────────
    const snapshotBucket: s3.Bucket = new s3.Bucket(this, 'SnapshotBucket', {
      bucketName: config.dbSnapshotBucket,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    // ── 5e. Container Registry ─────────────────────────────────────────────
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

    // ── 5f. IAM ────────────────────────────────────────────────────────────
    const instanceRole: iam.Role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Daily Orbit EC2 instance role',
    });

    // ECR pull
    ecrRepo.grantPull(instanceRole);

    // S3 snapshot bucket
    snapshotBucket.grantReadWrite(instanceRole);

    // Secrets Manager TLS secrets
    tlsCertSecret.grantRead(instanceRole);
    tlsKeySecret.grantRead(instanceRole);

    // EC2 EIP association
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AssociateAddress'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'ec2:ResourceTag/aws:cloudformation:stack-name': this.stackName,
          },
        },
      }),
    );

    // Bedrock for AI features
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
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

    // ── 5g. Compute ────────────────────────────────────────────────────────
    const __dirname: string = dirname(fileURLToPath(import.meta.url));
    const userDataRaw: string = readFileSync(resolve(__dirname, 'user-data.sh'), 'utf-8');

    const ecrUri: string = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${config.ecrRepositoryName}`;

    const userDataRendered: string = userDataRaw
      .replaceAll('{{EIP_ALLOCATION_ID}}', eip.attrAllocationId)
      .replaceAll('{{DB_SNAPSHOT_BUCKET}}', config.dbSnapshotBucket)
      .replaceAll('{{DB_SNAPSHOT_KEY}}', config.dbSnapshotKey)
      .replaceAll('{{REGION}}', this.region)
      .replaceAll('{{ECR_URI}}', ecrUri)
      .replaceAll('{{CONTAINER_TAG}}', config.containerTag)
      .replaceAll('{{SNAPSHOT_INTERVAL}}', String(config.snapshotIntervalMinutes));

    const userData: ec2.UserData = ec2.UserData.custom(userDataRendered);

    const launchTemplate: ec2.LaunchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      instanceType: new ec2.InstanceType(config.instanceType),
      role: instanceRole,
      userData,
      securityGroup,
      requireImdsv2: true,
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

    // ── 5h. Outputs ────────────────────────────────────────────────────────
    new CfnOutput(this, 'ElasticIpAddress', {
      value: eip.ref,
      description: 'Elastic IP address',
    });

    new CfnOutput(this, 'AppUrl', {
      value: `https://${config.domainName}`,
      description: 'Application URL',
    });

    new CfnOutput(this, 'EcrRepositoryUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR repository URI',
    });

    new CfnOutput(this, 'SnapshotBucketName', {
      value: snapshotBucket.bucketName,
      description: 'S3 snapshot bucket name',
    });
  }
}
