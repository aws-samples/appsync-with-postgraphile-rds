# Managed GraphQL API solution for RDS Postgres database with AWS AppSync and Postgraphile

![A diagram of the architecture solution Overview](./images/overview.png "Solution Overview")

This repo provides a CDK-based solution that allows you to create an AWS AppSync API from a defined Postgres database in AWS RDS.

For more information about the solution and a detailed walk-through, please see the related blog.

## Getting Started

```sh
git clone https://github.com/aws-samples/appsync-with-postgraphile-rds.git
cd appsync-with-postgraphile-rds
npm install
```

## VPC with RDS (optional step)

If you do not have an existing PostgreSQL RDS, the **vpc-with-pg** app will deploy a VPC with public and private subnets with NAT Gateway and provision an RDS instance into the private subnet.

### Deploy

```sh
cd ./vpc-with-pg
npm run cdk deploy -- --all -O output.json
cd ..
```

### Loading the database (optional)

If you do not have an existing database schema and data, you can leverage the provided [schema](vpc-with-pg/lib/layers/pg-dbschema-layer/lib/dbschema.sql) to get started. You can load the schema and some data by using the [`dbschema.ts`](vpc-with-pg/lib/functions/dbschema.ts) lambda function that was deployed in the previous step.

```sh
cd ./vpc-with-pg
npm run load
cd ..
```

## The solution

Deploy the solution into an existing vpc with RDS, or after **vpc-with-pg**.

You must use RDS Proxy with IAM authorization.
<https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html>

## Deploy the solution

Use the `deploy` script to help configure your context and parameters. The script uses values from **vpc-with-pg**'s `output.json`.

```bash
cd ./pg-with-graphile
npm run deploy -- --username <username> --database <database> --schemas <schemas>
```

For example, if you deployed **vpc-with-pg** along with the demo data provided, you would run the following command:

```bash
cd ./pg-with-graphile
npm run deploy -- --username lambda_runner --database forum_demo_with_appsync --schemas forum_example
```

After deployment, run the `update` script to update your API and create your schema cache layer

```bash
npm run update
```

Done.

## Clean up

When you are done with the solution, you can delete your resources by running the scripts below.

```sh
cd ./pg-with-graphile
npm run cdk destroy
cd ./vpc-with-pg
npm run cdk destroy -- --all
```
