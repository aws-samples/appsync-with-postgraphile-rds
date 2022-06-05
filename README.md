# Managed GraphQL API solution for RDS Postgres database with AWS AppSync and Postgraphile

![A diagram of the architecture solution Overview](./images/overview.png "Solution Overview")

This repo provides a CDK-based solution that allows you to create an AWS AppSync API from a defined Postgres database in AWS RDS.

The solution leverages PostGraphile to help create an AppSync-comptabile schema and then uses Lambda function to resolve the query operations from Appsync. The solution does not require writing any code and works with any Postgres database (e.g.: RDS Aurora Postgres).

1. Deploy the CDK solution.
2. Operator triggers update process by calling the  `provider` function
3. `provider` function retrieves schema information from RDS database
4. `provider` updates the Lambda layer attached to the `resolver` Lambda function and updates the AppSync API schema
5. A GraphQL request is made to the AppSync API
6. AppSync authorizes the request with Cognito (optional) or with the configured authorization mode.
7. AppSync resolves the request by calling the attached Direct Lambda Resolver. The identity of the requester is included in the request to the Lambda function
8. The Lambda function resolves the query using the PostGraphile schema and RDS database

For more information about the solution and a detailed walk-through, please see the related [blog](http://todo).

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

**Note**: this lambda function also takes care of defining a database user `lambda_runner` (a user with restricted privileges) that will be used to execute all of our queries against the database.

The schema defines a `Person` and `Post` table inside a database called `forum_demo_with_appsync`

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

Use the `deploy` script to deploy the CDK solution. The script uses values from **vpc-with-pg**'s `output.json` to configure the stacks context environment and variables.

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
