'use strict'

const randomatic = require('randomatic')
const { execFile } = require('child_process')
const Promise = require('bluebird')

const TERMINATION_TIMEOUT = 30 * 1000

function createServiceId (serviceName) {
  return `${serviceName || 'unknown'}-${randomatic('a0', 5)}`
}

const SIGNAL = 0
const SIGINT = 2
const SIGKILL = 9

function waitForTermination (childProcess) {
  return new Promise((resolve, reject) => {
    try {
      if (!childProcess.kill(SIGNAL)) {
        resolve()
      } else {
        childProcess.once('exit', () => {
          resolve()
        })
      }
    } catch (err) {
      if (err.code !== 'ESRCH') {
        throw err
      }
      resolve()
    }
  })
}

function terminateGracefully (childProcess) {
  return Promise.try(() => {
    console.log(`Starting termination of process ${childProcess.pid}`)
    childProcess.kill(SIGINT)
  })
    .catch(err => {
      if (err.code !== 'ESRCH') {
        throw err
      }
    })
    .then(() => {
      return waitForTermination(childProcess)
        .timeout(TERMINATION_TIMEOUT)
    })
    .catch(Promise.TimeoutError, () => {
      console.error(`Process ${childProcess.pid} is not terminating, stating force shutdown`)
      childProcess.kill(SIGKILL)
      return waitForTermination()
        .timeout(TERMINATION_TIMEOUT)
    })
    .tap(() => console.log(`Process ${childProcess.pid} is terminated`))
    .catch(err => {
      if (err.code !== 'ESRCH') {
        throw err
      }
    })
}

exports.ServiceManager = class {
  constructor () {
    this.services = {}
  }

  startService (options) {
    const serviceId = options.serviceId || createServiceId(options.serviceName)
    const init = options.init || (() => {})

    return this.checkService(serviceId)
      .then(isRunning => {
        if (!isRunning) {
          return Promise.try(init)
            .then(() => {
              const child = execFile(options.executable, options.arguments || [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: options.env || {},
                cwd: options.cwd || '.'
              })
              child.stdout.pipe(options.logStream, { end: false })
              child.stderr.pipe(options.logStream, { end: false })

              console.log(`Service ${serviceId} start running with PID: ${child.pid}`)

              this.services[serviceId] = { child }
            })
        }
      })
      .return(serviceId)
  }

  checkService (serviceId) {
    if (serviceId && this.services[serviceId] && this.services[serviceId].child) {
      return Promise.try(() => this.services[serviceId].child.kill(SIGNAL))
        .catch(err => {
          if (err.code !== 'ESRCH') {
            throw err
          }
          return false
        })
    } else {
      return Promise.resolve(false)
    }
  }

  stopService (serviceId) {
    if (this.services[serviceId] && this.services[serviceId].child) {
      return terminateGracefully(this.services[serviceId].child)
    } else {
      return Promise.resolve(false)
    }
  }
}
