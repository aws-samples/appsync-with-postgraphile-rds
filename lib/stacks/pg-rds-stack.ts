import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {Vpc, SecurityGroup, SubnetType, Port, InstanceType, InstanceClass, InstanceSize } from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'

export interface RdsProps extends StackProps {
  vpc: Vpc
  port: number
  stage: string
  dbUsername: string
}

export class PgRdsStack extends Stack {
  public readonly postgresSecret: Secret;
  public readonly lambdaRunnerSecret: Secret;
  public readonly rdsCluster: rds.DatabaseCluster;
  public readonly rdsProxy: rds.DatabaseProxy;
  public readonly lambdaSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: RdsProps) {
    super(scope, id, props);

    // first generate a secret to be used as credentials for the database
    this.postgresSecret = new Secret(this, `${props?.stage}-DBCredentialsSecret`, {
      secretName: `${props?.stage}-appsync-sample-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'postgres',
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
    });

    // next, create a secret for the Lambda function user
    this.lambdaRunnerSecret = new Secret(this, `${props?.stage}-appsyncGraphileSecret-DBCredentialsSecret`, {
      secretName: `${props?.stage}-lambda-runner-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: props.dbUsername,
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
    });


    // Create a security group to be used on the lambda functions
    this.lambdaSecurityGroup = new SecurityGroup(this, 'Lambda Security Group', {
      vpc: props.vpc,
    });

    // Create a security group to be used on the RDS proxy
    const rdsProxySecurityGroup = new SecurityGroup(this, 'Only Allow Access From Lambda', {
      vpc: props.vpc,
    });

    rdsProxySecurityGroup.addIngressRule(this.lambdaSecurityGroup, Port.tcp(props.port), 'allow lambda connection to rds proxy');

    // Create a security group to be used on the RDS instances
    const rdsSecurityGroup = new SecurityGroup(this, 'Only Allow Access From RDS Proxy', {
      vpc: props.vpc,
    });
    rdsSecurityGroup.addIngressRule(rdsProxySecurityGroup, Port.tcp(props.port), 'allow db connections from the rds proxy');


    this.rdsCluster = new rds.DatabaseCluster(this, `${props?.stage}-instance`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6
      }),
      credentials: rds.Credentials.fromSecret(this.postgresSecret),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      },
      port: props.port,
      securityGroups: [ rdsSecurityGroup ],
      writer: rds.ClusterInstance.provisioned('writer', {
        publiclyAccessible: false,
        instanceType: InstanceType.of(InstanceClass.R8G, InstanceSize.LARGE),
      }),
      clusterIdentifier: `${props?.stage}-appsync-sample-PG`,      
      removalPolicy: RemovalPolicy.DESTROY, // this is a test solution, so want to destroy on delete
      deletionProtection: false,
    });

    this.lambdaRunnerSecret.attach(this.rdsCluster);

    this.rdsProxy = this.rdsCluster.addProxy(`${id}-appsync-sample-proxy`, {
      vpc: props.vpc,
      securityGroups: [rdsProxySecurityGroup],
      iamAuth: true,
      secrets: [this.postgresSecret, this.lambdaRunnerSecret],
      debugLogging: true,
    });

    // output credentials
    new CfnOutput(this, 'RDS Admin Secret Name', { value: this.postgresSecret.secretName });
    new CfnOutput(this, 'RDS Admin Secret ARN', { value: this.postgresSecret.secretArn });
    new CfnOutput(this, 'RDS Admin Secret Full ARN', { value: this.postgresSecret.secretFullArn || '' });

    new CfnOutput(this, 'Lambda RDS Secret Name', { value: this.lambdaRunnerSecret.secretName });
    new CfnOutput(this, 'Lambda RDS Secret ARN', { value: this.lambdaRunnerSecret.secretArn });
    new CfnOutput(this, 'Lambda RDS Secret Full ARN', { value: this.lambdaRunnerSecret.secretFullArn || '' });

    new CfnOutput(this, 'RDS Endpoint', { value: this.rdsCluster.clusterEndpoint.hostname });
    new CfnOutput(this, 'RDS Proxy Endpoint', { value: this.rdsProxy.endpoint });
    new CfnOutput(this, 'RDS Proxy ARN', { value: this.rdsProxy.dbProxyArn });
    new CfnOutput(this, 'RDS Proxy Name', { value: this.rdsProxy.dbProxyName });
    new CfnOutput(this, 'Lambda Security Group Id', { value: this.lambdaSecurityGroup.securityGroupId });
  }
}
