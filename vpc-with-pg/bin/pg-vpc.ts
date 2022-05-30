#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { PgVpcStack } from '../lib/pg-vpc-stack'
import { PgRdsStack } from '../lib/pg-rds-stack'
import { PgSchemaStack } from '../lib/pg-schema-stack'

const tagProps = {
  tags: {
    app: 'appsync-rds-pg-as-a-datasource',
  },
}
class RdsPgApp extends Construct {
  constructor(scope: cdk.App, id: string) {
    super(scope, id)

    const vpcStack = new PgVpcStack(app, 'PgVpcStack', {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
      cidr: '10.0.0.0/16',
      ...tagProps,
    })
    const rdsStack = new PgRdsStack(app, 'PgRdsStack', {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
      vpc: vpcStack.vpc,
      port: 5432,
      stage: id,
      ...tagProps,
    })
    new PgSchemaStack(app, 'PgSchemaStack' {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
      vpc: vpcStack.vpc,
      stage: id,
      port: rdsStack.rdsInstance.port,
      rdsProxy: rdsStack.rdsProxy,
      sg: rdsStack.dbConnectionGroup,
      database: rdsStack.rdsInstance.hostname,
      userName: rdsStack.lambdaRunnerSecret.secretValueFromJson('username').toString()
    })
  }
}

const app = new cdk.App({})
new RdsPgApp(app, 'dev')
