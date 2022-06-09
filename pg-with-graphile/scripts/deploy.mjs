import { spawn } from 'child_process'
import arg from 'arg'
import aws from 'aws-sdk'

const args = arg({
  '--region': String,
  '--proxy': String,
  '--sg': String,
  '--username': String,
  '--database': String,
  '--schemas': String,
})

async function run() {
  try {
    const reqs = [('--region', '--proxy', '--sg', '--username', '--database', '--schemas')]
    reqs.forEach((a) => {
      if (!args[a]) throw new Error(`missing required argument: ${a}`)
    })

    const rds = new aws.RDS({ region: args['--region'] })

    const result = await rds.describeDBProxies({ DBProxyName: args['--proxy'] }).promise()

    const proxy = result.DBProxies[0]
    if (!proxy) {
      throw new Error('proxy not found')
    }

    const vpcId = proxy.VpcId
    const sgId = args['--sg']

    const dbProxyArn = proxy.DBProxyArn
    const dbProxyName = proxy.DBProxyName
    const endpoint = proxy.Endpoint

    const username = args['--username']
    const database = args['--database']
    const schemas = args['--schemas']

    await doNpmDeploy(vpcId, sgId, dbProxyArn, dbProxyName, endpoint, username, database, schemas)
  } catch (error) {
    return console.log('Error: ' + error.message)
  }
}

export async function doNpmDeploy(vpcId, sgId, dbProxyArn, dbProxyName, endpoint, username, database, schemas) {
  const opts = `-c vpcId=${vpcId} \
  --parameters sgId=${sgId} \
  --parameters dbProxyArn=${dbProxyArn} \
  --parameters dbProxyName=${dbProxyName} \
  --parameters dbProxyEndpoint=${endpoint} \
  --parameters userName=${username} \
  --parameters database=${database} \
  --parameters schemas=${schemas} \
  -O output.json`.split(/\s+/)

  spawn('npm', ['run', 'cdk', 'deploy', '--', ...opts], { stdio: 'inherit' })
}

run()
