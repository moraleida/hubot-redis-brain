'use strict'

// Description:
//   Persist hubot's brain to redis
//
// Configuration:
//   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
//     URL format: redis://<host>:<port>[/<brain_prefix>]
//     URL format (UNIX socket): redis://<socketpath>[?<brain_prefix>]
//     If not provided, '<brain_prefix>' will default to 'hubot'.
//   REDIS_NO_CHECK - set this to avoid ready check (for exampel when using Twemproxy)
//
// Commands:
//   None

const Url = require('url')
const Redis = require('redis')

module.exports = function (robot) {
  let client, prefix
  const redisUrlEnv = getRedisEnv()
  const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'
  const redisDataFormat = process.env['REDIS_DATA_FORMAT'] || 'text'
  const redisDataMigrate = process.env['REDIS_DATA_MIGRATE'] || false

  robot.config = Object.assign(robot.config || {}, { redisUrl })
  if (redisUrlEnv) {
    robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable`)
  } else {
    robot.logger.info('hubot-redis-brain: Using default redis on localhost:6379')
  }

  if (process.env.REDIS_NO_CHECK) {
    robot.logger.info('Turning off redis ready checks')
  }

  const info = Url.parse(redisUrl)

  if (info.hostname === '') {
    client = Redis.createClient(info.pathname)
    prefix = (info.query ? info.query.toString() : undefined) || 'hubot'
  } else {
    client = (info.auth || process.env.REDIS_NO_CHECK)
              ? Redis.createClient(info.port, info.hostname, {no_ready_check: true})
            : Redis.createClient(info.port, info.hostname)
    prefix = (info.path ? info.path.replace('/', '') : undefined) || 'hubot'
  }

  robot.brain.setAutoSave(false)

  const getTextData = () => {
    client.get(`${prefix}:storage`).then((reply) => {
      if (reply) {
        robot.logger.info(`hubot-redis-brain: Text Data for ${prefix} brain retrieved from Redis`)
        robot.brain.mergeData(JSON.parse(reply.toString()))
        robot.brain.emit('connected')
      } else {
        robot.logger.info(`hubot-redis-brain: Initializing new Text data for ${prefix} brain`)
        robot.brain.mergeData({})
        robot.brain.emit('connected')
      }
      robot.brain.setAutoSave(true)
    })

  const getJSONData = () => {
    client.json.get(`${prefix}:JSONstorage`).then((reply) => {
      if (reply) {
        robot.logger.info(`hubot-redis-brain: JSON Data for ${prefix} brain retrieved from Redis`)
        robot.brain.mergeData(JSON.parse(reply.toString()))
        robot.brain.emit('connected')
      } else {

        if ( robot.brain.data.length === 0 && redisDataMigrate === 'true' ) {
          // first instantiation, pull data from the text storage
          robot.logger.info(`hubot-redis-brain: Attempting to migrate data from ${prefix}:storage into ${prefix}:JSONstorage`)
          getTextData();
          client.json.set(`${prefix}:JSONstorage`, robot.brain.data)
          robot.brain.emit('connected')
        } else {
          robot.logger.info(`hubot-redis-brain: Initializing new JSON data for ${prefix}:JSONstorage brain`)
          robot.brain.mergeData({})
          robot.brain.emit('connected')
        }
      }
    })

  }

  const getData = () => {
    if (redisDataFormat === 'json') {
      getJSONData()
    } else {
      getTextData()
    }
  }

  if (info.auth) {
    client.auth(info.auth.split(':')[1], function (err) {
      if (err) {
        return robot.logger.error('hubot-redis-brain: Failed to authenticate to Redis')
      }

      robot.logger.info('hubot-redis-brain: Successfully authenticated to Redis')
      getData()
    })
  }

  client.on('error', function (err) {
    if (/ECONNREFUSED/.test(err.message)) {

    } else {
      robot.logger.error(err.stack)
    }
  })

  client.on('connect', function () {
    robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
    if (!info.auth) { getData() }
  })

  robot.brain.on('save', (data) => {
    if (!data) {
      data = {}
    }

    if (redisDataFormat === 'json') {
      if (!data.storageKey) {
        robot.logger.error('hubot-redis-brain: storageKey is required for saving JSON data. No data was saved.')
        return
      }

      const key = data.storageKey;
      data = data[key];

      client.json.set(`${prefix}:JSONstorage`, key, data)
    } else {
      client.set(`${prefix}:storage`, JSON.stringify(data))
    }
  })

  robot.brain.on('close', () => client.quit())
}

function getRedisEnv () {
  if (process.env.REDISTOGO_URL) {
    return 'REDISTOGO_URL'
  }

  if (process.env.REDISCLOUD_URL) {
    return 'REDISCLOUD_URL'
  }

  if (process.env.BOXEN_REDIS_URL) {
    return 'BOXEN_REDIS_URL'
  }

  if (process.env.REDIS_URL) {
    return 'REDIS_URL'
  }
}
