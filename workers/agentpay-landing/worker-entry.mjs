import worker from './worker.js'

export default {
  fetch(request) {
    return worker.handleRequest(request)
  },
}
