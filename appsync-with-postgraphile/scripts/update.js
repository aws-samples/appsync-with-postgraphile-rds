const config = require('../output.json')
const aws = require('aws-sdk')
const lambdaClient = new aws.Lambda({ region: config.PgAsDatasourceWithGraphileStack.region })

async function run() {
  const result = await lambdaClient
    .invoke({
      FunctionName: config.PgAsDatasourceWithGraphileStack.providerName,
    })
    .promise()
  console.log(result)
}

console.log('Preparing Direct Lambda Resolver and AppSync API')
run()
