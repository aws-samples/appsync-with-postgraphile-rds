import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {Vpc, IpAddresses, SubnetType } from 'aws-cdk-lib/aws-ec2'

export interface VpcProps extends StackProps {
  cidr: string
}

export class PgVpcStack extends Stack {
  public readonly vpc: Vpc

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id, props)

    this.vpc = new Vpc(this, 'appsync-pg-sample-vpc', {
      ipAddresses: IpAddresses.cidr(props.cidr),
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'private-subnet-',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'public-subnet-',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    })
    new CfnOutput(this, 'VPC ID', { value: this.vpc.vpcId })
  }
}
