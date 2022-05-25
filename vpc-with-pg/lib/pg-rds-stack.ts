import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'

export interface RdsProps extends StackProps {
  vpc: ec2.Vpc
  port: number
  stage: string
}

export class PgRdsStack extends Stack {
  readonly postgresSecret: ISecret
  readonly lambdaRunnerSecret: ISecret
  readonly rdsInstance: rds.DatabaseInstance
  readonly rdsProxy: rds.DatabaseProxy
  readonly dbConnectionGroup: ec2.ISecurityGroup

  constructor(scope: Construct, id: string, props: RdsProps) {
    super(scope, id, props)

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
    })

    // next, create a secret for the Lambda function user
    this.lambdaRunnerSecret = new Secret(this, `${props?.stage}-appsyncGraphileSecret-DBCredentialsSecret`, {
      secretName: `${props?.stage}-lambda-runner-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'lambda_runner',
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
    })

    // output credentials
    new CfnOutput(this, 'Secret Name', { value: this.postgresSecret.secretName })
    new CfnOutput(this, 'Secret ARN', { value: this.postgresSecret.secretArn })
    new CfnOutput(this, 'Secret Full ARN', { value: this.postgresSecret.secretFullArn || '' })

    // next, create a new string parameter to be use
    new StringParameter(this, 'DBCredentialsArn', {
      parameterName: `${props?.stage}-credentials-arn`,
      stringValue: this.postgresSecret.secretArn,
    })

    // get the default security group
    //this.defaultSG = ec2.SecurityGroup.fromSecurityGroupId(this, "SG", props.vpc.vpcDefaultSecurityGroup);
    // We need this security group to add an ingress rule and allow our lambda to query the proxy
    let lambdaToRDSProxyGroup = new ec2.SecurityGroup(this, 'Lambda to RDS Proxy Connection', {
      vpc: props.vpc,
    })
    // We need this security group to allow our proxy to query our RDS Instance
    this.dbConnectionGroup = new ec2.SecurityGroup(this, 'Proxy to DB Connection', {
      vpc: props.vpc,
    })

    this.dbConnectionGroup.addIngressRule(this.dbConnectionGroup, ec2.Port.tcp(props.port), 'allow db connection')
    this.dbConnectionGroup.addIngressRule(lambdaToRDSProxyGroup, ec2.Port.tcp(props.port), 'allow lambda connection')

    // create the RDS instance
    this.rdsInstance = new rds.DatabaseInstance(this, `${props?.stage}-instance`, {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_13 }),
      // optional, defaults to m5.large
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.LARGE),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      },
      instanceIdentifier: `${props?.stage}-appsync-sample-PG`,
      maxAllocatedStorage: 200,
      securityGroups: [this.dbConnectionGroup],
      removalPolicy: RemovalPolicy.DESTROY, // this is a test solution, so want to destroy on delete
      deletionProtection: false,
      credentials: rds.Credentials.fromSecret(this.postgresSecret), // Get both username and password from existing secret
    })
    this.lambdaRunnerSecret.attach(this.rdsInstance)

    this.rdsProxy = this.rdsInstance.addProxy(id + '-appsync-sample-proxy', {
      secrets: [this.postgresSecret, this.lambdaRunnerSecret],
      debugLogging: true,
      iamAuth: true,
      vpc: props.vpc,
      securityGroups: [this.dbConnectionGroup],
    })

    // Workaround for bug where TargetGroupName is not set but required
    let targetGroup = this.rdsProxy.node.children.find((child: any) => {
      return child instanceof rds.CfnDBProxyTargetGroup
    }) as rds.CfnDBProxyTargetGroup

    targetGroup.addPropertyOverride('TargetGroupName', 'default')

    // output the endpoint
    new CfnOutput(this, 'RDS Endpoint', { value: this.rdsInstance.dbInstanceEndpointAddress })
    new CfnOutput(this, 'RDS Proxy Endpoint', { value: this.rdsProxy.endpoint })
    new CfnOutput(this, 'RDS Proxy ARN', { value: this.rdsProxy.dbProxyArn })
    new CfnOutput(this, 'RDS Proxy Name', { value: this.rdsProxy.dbProxyName })
    new CfnOutput(this, 'Lambda Security Group Id', { value: lambdaToRDSProxyGroup.securityGroupId })
  }
}
