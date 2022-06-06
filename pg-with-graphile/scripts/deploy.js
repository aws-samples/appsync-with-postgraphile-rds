const { spawn } = require('child_process')
const arg = require('arg')
const aws = require('aws-sdk')

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

    const opts = `-c vpcId=${vpcId} \
--parameters sgId=${sgId} \
--parameters dbProxyArn=${dbProxyArn} \
--parameters dbProxyName=${dbProxyName} \
--parameters dbProxyEndpoint=${endpoint} \
--parameters userName=${args['--username']} \
--parameters database=${args['--database']} \
--parameters schemas=${args['--schemas']} \
-O output.json`.split(' ')

    const running = spawn('npm', ['run', 'cdk', 'deploy', '--', ...opts], { stdio: 'inherit' })
  } catch (error) {
    return console.log('Error: ' + error.message)
  }
  console.log('Done')
}

console.log('Deploying...')
run()
