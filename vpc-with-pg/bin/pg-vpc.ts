#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { PgVpcStack } from '../lib/pg-vpc-stack'
import { PgRdsStack } from '../lib/pg-rds-stack'
import { Construct } from 'constructs'

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
    new PgRdsStack(app, 'PgRdsStack', {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
      vpc: vpcStack.vpc,
      port: 5432,
      stage: id,
      ...tagProps,
    })
  }
}

const app = new cdk.App({})
new RdsPgApp(app, 'dev')
