import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export interface VpcProps extends StackProps {
  cidr: string
}

export class PgVpcStack extends Stack {
  public readonly vpc: ec2.Vpc

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id, props)

    this.vpc = new ec2.Vpc(this, 'APPSYNC-PG-SAMPLE-VPC', {
      cidr: props.cidr,
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'private-subnet-',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 24,
        },
        {
          name: 'public-subnet-',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    })
    new CfnOutput(this, 'VPC ID', { value: this.vpc.vpcId })
  }
}
