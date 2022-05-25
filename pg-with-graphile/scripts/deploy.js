const { spawn } = require('child_process')
const arg = require('arg')
const config = require('../../vpc-with-pg/output.json')

// vpc info
const vpcId = config.PgVpcStack.VPCID
const sgId = config.PgRdsStack.LambdaSecurityGroupId

// rds proxy info
const dbProxyArn = config.PgRdsStack.RDSProxyARN
const dbProxyName = config.PgRdsStack.RDSProxyName
const endpoint = config.PgRdsStack.RDSProxyEndpoint

const args = arg({
  '--username': String,
  '--database': String,
  '--schemas': String,
})

const reqs = [('--username', '--database', '--schemas')]
reqs.forEach((a) => {
  if (!args[a]) throw new Error(`missing required argument: ${a}`)
})

const cmd = `npm run cdk deploy -- \
-c vpcId=${vpcId} \
--parameters sgId=${sgId} \
--parameters dbProxyArn=${dbProxyArn} \
--parameters dbProxyName=${dbProxyName} \
--parameters dbProxyEndpoint=${endpoint} \
--parameters userName=${args['--username']} \
--parameters database=${args['--database']} \
--parameters schemas=${args['--schemas']} \
-O output.json
`

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
