import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Stack,
  StackProps,
  CfnOutput,
  CfnResource,
  RemovalPolicy,
  Duration,
  Tags,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import type { SeedConfig } from "./config.js";

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
      ? ec2.Vpc.fromLookup(this, "Vpc", { vpcId: config.vpcId })
      : new ec2.Vpc(this, "Vpc", {
          maxAzs: 2,
          natGateways: 1,
        });

    const securityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      "InstanceSg",
      {
        vpc,
        description: "Daily Orbit instance security group",
        allowAllOutbound: true,
      },
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS",
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "HTTP redirect",
    );
    // securityGroup.addIngressRule(
    //   ec2.Peer.anyIpv4(),
    //   ec2.Port.tcp(9900),
    //   "App HTTP (dev)",
    // );
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), "SSH");

    const eip: ec2.CfnEIP = new ec2.CfnEIP(this, "Eip", {
      tags: [{ key: "Name", value: `${config.stackName}-eip` }],
    });

    // ── 5b. DNS ────────────────────────────────────────────────────────────
    const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(
      this,
      "Zone",
      {
        domainName: config.domainName,
      },
    );

    // API subdomain → Elastic IP
    new route53.ARecord(this, "ApiRecord", {
      zone: hostedZone,
      recordName: config.apiDomainName,
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
    });

    // ── 5d. Storage ──────────────────────────────────────────────────────
    // Import the existing S3 bucket (created outside CDK)
    const snapshotBucket: s3.IBucket = s3.Bucket.fromBucketName(
      this,
      "SnapshotBucket",
      config.dbSnapshotBucket,
    );

    // ── 5d2. Persistent EBS Data Volume ─────────────────────────────────
    // Manually-created XFS volume replacing the original CDK-managed ext4
    // volume (which is orphaned via RETAIN and can be deleted once verified).
    const dataVolume = ec2.Volume.fromVolumeAttributes(this, "DataVolumeV2", {
      volumeId: "vol-0283624e12ef2be3a",
      availabilityZone: config.availabilityZone,
    });

    // ── 5e. Container Registry ───────────────────────────────────────────
    const ecrRepo: ecr.Repository = new ecr.Repository(this, "EcrRepo", {
      repositoryName: config.ecrRepositoryName,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: "Expire untagged images after 7 days",
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(7),
        },
      ],
    });

    // ── 5f. IAM ──────────────────────────────────────────────────────────
    const instanceRole: iam.Role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Daily Orbit EC2 instance role",
    });

    // ECR pull
    ecrRepo.grantPull(instanceRole);

    // S3 snapshot bucket
    snapshotBucket.grantReadWrite(instanceRole);

    // EC2 EIP association
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:AssociateAddress"],
        resources: ["*"],
      }),
    );

    // Bedrock for AI features
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:ListFoundationModels",
          "bedrock:InvokeModel",
          "bedrock:Converse",
          "bedrock:ConverseStream",
          "bedrock:ListInferenceProfiles",
          "bedrock:ListFoundationModels",
        ],
        resources: ["*"],
      }),
    );

    // SES for alerts
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    // EBS volume attach/detach for persistent data volume
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:AttachVolume", "ec2:DetachVolume", "ec2:DescribeVolumes"],
        resources: ["*"],
      }),
    );

    // CloudWatch Logs for structured log shipping
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
          "logs:StartQuery",
          "logs:GetQueryResults",
        ],
        resources: ["*"],
      }),
    );

    // ── 5g. Compute ──────────────────────────────────────────────────────
    const __dirname: string = dirname(fileURLToPath(import.meta.url));
    const userDataRaw: string = readFileSync(
      resolve(__dirname, "user-data.sh"),
      "utf-8",
    );

    const ecrUri: string = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${config.ecrRepositoryName}`;

    const userDataRendered: string = userDataRaw
      .replaceAll("{{EIP_ALLOCATION_ID}}", eip.attrAllocationId)
      .replaceAll("{{DB_SNAPSHOT_BUCKET}}", config.dbSnapshotBucket)
      .replaceAll("{{REGION}}", this.region)
      .replaceAll("{{ECR_URI}}", ecrUri)
      .replaceAll("{{CONTAINER_TAG}}", config.containerTag)
      .replaceAll("{{DATA_VOLUME_ID}}", dataVolume.volumeId);

    const userData: ec2.UserData = ec2.UserData.custom(userDataRendered);

    const launchTemplate: ec2.LaunchTemplate = new ec2.LaunchTemplate(
      this,
      "LaunchTemplate",
      {
        machineImage: ec2.MachineImage.fromSsmParameter(
          "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id",
        ),
        instanceType: new ec2.InstanceType(config.instanceType),
        role: instanceRole,
        userData,
        securityGroup,
        requireImdsv2: true,
        keyPair: config.keyPairName
          ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", config.keyPairName)
          : undefined,
        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: ec2.BlockDeviceVolume.ebs(60, {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
            }),
          },
        ],
      },
    );

    // Broad pool of ARM64 instance types for spot capacity diversity.
    // Constraints: ARM64 AMI and ≥16 GB RAM (observed peak usage is <8 GB,
    // so 16 GB is comfortable headroom). Both `d` (local instance store)
    // and non-`d` (EBS-only) variants are fine because user-data.sh
    // resolves the data volume by its EBS volume ID via /dev/disk/by-id
    // symlinks, not a hardcoded device path.
    const spotInstanceTypes: string[] = [
      // ── 16 GB tier ─────────────────────────────────────────────────
      // Memory-optimized (r*, 8 GB/vCPU) — .large = 2 vCPU / 16 GB
      "r6g.large",
      "r6gd.large",
      "r7g.large",
      "r7gd.large",
      "r8g.large",
      "r8gd.large",
      // General-purpose (m*, 4 GB/vCPU) — .xlarge = 4 vCPU / 16 GB
      "m6g.xlarge",
      "m6gd.xlarge",
      "m7g.xlarge",
      "m7gd.xlarge",
      "m8g.xlarge",
      "m8gd.xlarge",
      // Compute-optimized (c*, 2 GB/vCPU) — .2xlarge = 8 vCPU / 16 GB
      "c6g.2xlarge",
      "c6gd.2xlarge",
      "c7g.2xlarge",
      "c7gd.2xlarge",
      "c8g.2xlarge",
      "c8gd.2xlarge",
      // ── 32 GB tier ─────────────────────────────────────────────────
      "r6g.xlarge",
      "r6gd.xlarge",
      "r7g.xlarge",
      "r7gd.xlarge",
      "r8g.xlarge",
      "r8gd.xlarge",
      "m6g.2xlarge",
      "m6gd.2xlarge",
      "m7g.2xlarge",
      "m7gd.2xlarge",
      "m8g.2xlarge",
      "m8gd.2xlarge",
    ];

    new autoscaling.AutoScalingGroup(this, "Asg", {
      vpc,
      vpcSubnets: {
        availabilityZones: [config.availabilityZone],
        subnetType: ec2.SubnetType.PUBLIC,
      },
      mixedInstancesPolicy: {
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: 0,
          spotAllocationStrategy:
            autoscaling.SpotAllocationStrategy.PRICE_CAPACITY_OPTIMIZED,
        },
        launchTemplate,
        launchTemplateOverrides: spotInstanceTypes.map((t) => ({
          instanceType: new ec2.InstanceType(t),
        })),
      },
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      // Matches the ~1 hour attach-volume retry window in user-data.sh:
      // a prior instance can take a long time to release the data volume,
      // and we don't want the ASG to kill a new instance mid-attach.
      defaultInstanceWarmup: Duration.hours(1),
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: Duration.hours(1),
      }),
    });

    // ── 6. CloudFront (frontend) ───────────────────────────────────────
    const frontendBucket: s3.Bucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `${config.stackName}-frontend`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // EC2 needs write access for newspaper image uploads
    frontendBucket.grantReadWrite(instanceRole);

    // Separate bucket for CloudFront standard access logs.
    // CloudFront log delivery uses the legacy ACL-based mechanism, which
    // requires `BUCKET_OWNER_PREFERRED` ownership (not the modern enforced
    // mode). Logs are gzipped and land within ~5-15 minutes of each request.
    const cloudfrontLogBucket: s3.Bucket = new s3.Bucket(
      this,
      "CloudFrontLogBucket",
      {
        bucketName: `${config.stackName}-cloudfront-logs`,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
        lifecycleRules: [
          {
            id: "expire-old-logs",
            expiration: Duration.days(30),
          },
        ],
      },
    );

    const cloudfrontCert: acm.ICertificate = acm.Certificate.fromCertificateArn(
      this,
      "CloudFrontCert",
      config.cloudfrontCertificateArn,
    );

    // CloudFront Function: SPA routing on the default behavior.
    // Rewrites non-file paths to /index.html so client-side routing works.
    // This replaces distribution-level errorResponses, which cannot be
    // scoped per-behavior and were silently masking missing images.
    const spaRoutingFn = new cloudfront.Function(this, "SpaRoutingFn", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        `
function handler(event) {
  var uri = event.request.uri;
  if (uri.match(/\\.[a-zA-Z0-9]+$/)) {
    return event.request;
  }
  event.request.uri = '/index.html';
  return event.request;
}
      `.trim(),
      ),
    });

    const distribution: cloudfront.Distribution = new cloudfront.Distribution(
      this,
      "Distribution",
      {
        defaultBehavior: {
          origin:
            origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [
            {
              function: spaRoutingFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        additionalBehaviors: {
          "newspaper/images/*": {
            origin:
              origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            compress: true,
          },
          // Reverse-proxy /ads/* to the API server so the public house-ad
          // export URLs live under the apex domain (dailyorbit.org/ads/...)
          // instead of the API host. The API mounts these routes at /ads/*
          // outside /api/* so the path passes through unchanged.
          "ads/*": {
            origin: new origins.HttpOrigin("api.dailyorbit.org", {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            }),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            compress: true,
          },
        },
        domainNames: [config.domainName],
        certificate: cloudfrontCert,
        defaultRootObject: "index.html",
        enableLogging: true,
        logBucket: cloudfrontLogBucket,
        logFilePrefix: "cf-logs/",
        logIncludesCookies: false,
      },
    );

    // dailyorbit.org → CloudFront
    new route53.ARecord(this, "ApexRecord", {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, "WwwRecord", {
      zone: hostedZone,
      recordName: "www",
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    // ── 5i. CloudWatch Logs Insights Saved Queries ────────────────────────
    // Reads query definitions from the shared cwl-queries.json used by both
    // the CLI tool (cwl-query.py) and these saved queries in the Console.
    const cwlQueriesPath: string = resolve(
      __dirname,
      "../../packages/server/debugscripts/cwl-queries.json",
    );
    const cwlQueries: CwlQueriesConfig = JSON.parse(
      readFileSync(cwlQueriesPath, "utf-8"),
    );

    for (const [name, qdef] of Object.entries(cwlQueries.queries)) {
      // Skip parameterized queries — they need runtime args, not useful as saved queries
      if (qdef.query.includes("{arg}")) continue;

      new CfnResource(this, `CwlQuery-${name}`, {
        type: "AWS::Logs::QueryDefinition",
        properties: {
          Name: `daily-orbit - ${name}`,
          QueryString: qdef.query,
          LogGroupNames: [cwlQueries.logGroup],
        },
      });
    }

    // ── 5h. Outputs ──────────────────────────────────────────────────────
    new CfnOutput(this, "ElasticIpAddress", {
      value: eip.ref,
      description: "Elastic IP address",
    });

    new CfnOutput(this, "ApiUrl", {
      value: `https://${config.apiDomainName}`,
      description: "API URL",
    });

    new CfnOutput(this, "EcrRepositoryUri", {
      value: ecrRepo.repositoryUri,
      description: "ECR repository URI",
    });

    new CfnOutput(this, "SnapshotBucketName", {
      value: snapshotBucket.bucketName,
      description: "S3 snapshot bucket name",
    });

    new CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "S3 bucket for frontend static assets",
    });

    new CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain",
    });

    new CfnOutput(this, "FrontendUrl", {
      value: `https://${config.domainName}`,
      description: "Frontend URL",
    });

    new CfnOutput(this, "DataVolumeId", {
      value: dataVolume.volumeId,
      description: "EBS volume ID for persistent data storage",
    });
  }
}
