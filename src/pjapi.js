/** WebWorker code */
const WorkerBlob = URL.createObjectURL(new Blob(['(',
    function () {
        const GLOBALS = {
            queue: [],
            timeout: 80,
            headers: {
                'Content-Type': 'application/json',
            },
            run: false,
            endpoint: '',
            maxGroup: 10,
            version: 100
        }
        
        self.onmessage = function (e) {
            const ops = Object.keys(e.data)
            const data = e.data
            ops.forEach(op => {
                switch (op) {
                    case 'immediate':
                        (() => {
                            const {id, ns, operation, args} = data[op];
                            const request = {payload: {}, version: GLOBALS.version}
                            request.payload[id] = {ns, function: operation, arguments: args}
                            excuteRequest(request)
                        })()
                        break
                    case 'request':
                        (() => {
                            const {id, ns, operation, args} = data[op];
                            GLOBALS.queue.push({id, ns, operation, args});
                        })()
                        break
                    case 'start':
                        if (GLOBALS.run === true) { return }
                        GLOBALS.run = true
                        processQueue()
                        break
                    case 'stop': 
                        GLOBALS.run = false
                        break
                    case 'setTimeout':
                        GLOBALS.timeout = parseInt(data[op].timeout)
                        if (isNaN(GLOBALS.timeout)) {
                            GLOBALS.timeout = 80
                        }
                        break
                    case 'setHeaders':
                        Object.keys(data[op].headers).forEach(key => {
                            GLOBALS.headers[key] = data[op].headers[key]
                        })
                        break
                    case 'setEndpoint': 
                        GLOBALS.endpoint = data[op].endpoint
                        break
                    case 'setMaxGrouping':
                        GLOBALS.maxGroup = parseInt(data[op].maxGroup)
                        if (isNaN(GLOBALS.maxGroup)) {
                            GLOBALS.maxGroup = 10
                        }
                        break
                    case 'setVersion':
                        GLOBALS.version = parseInt(data[op].version)
                        if (isNaN(GLOBALS.version)) {
                            GLOBALS.version = 100
                        }
                        break
                }
            })
        }
        
        function error (err) {
            postMessage({id: 0, result: {error: true, message: err}})
        }
        
        function readBody (textPromise, boundary) {
            textPromise.then(body => {
                const parts = body.split(boundary)
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim()
                    if (part.length === 0) { continue }
                    const lines = part.split('\r\n').map(str => str.trim())
                    const headers = {}
                    let body = ''
                    let j = 0
                    for (; j < lines.length; j++) {
                        if (lines[j].length === 0) {
                            break
                        }
                        const [key, value] = lines[j].split(':')
                        if (value === undefined) { continue }
                        headers[key.toLowerCase()] = value.trim()
                    }
                    j++
                    for (; j < lines.length; j++) {
                        body += lines[j]
                    }
                    if (body.length === 0) { continue }
        
                    if (headers['content-type'] === undefined) {
                        error('Invalid content type')
                        continue
                    }
                    const contentType = headers['content-type'].split(';')
                    if (contentType[0] !== 'application/json') {
                        error('Invalid content type')
                        continue
                    }
                    
                    try {
                        const result = JSON.parse(body)
                        if (result.error) {
                            error(result.message)
                            continue
                        }
                        Object.keys(result).forEach(id => {
                            postMessage({id, result: result[id]})
                        })
                    } catch (e) {
                        error(e.message)
                    }
                }        
            })
        }
        
        function excuteRequest (request) {
            return new Promise(resolve => {
                fetch(GLOBALS.endpoint, 
                    {
                        method: 'POST', 
                        body: JSON.stringify(request),
                        headers: GLOBALS.headers
                    }
                )
                .then(response => {
                    contentType = response.headers.get('Content-Type').split(';')
                    if (contentType[0] !== 'multipart/mixed') {
                        error('Invalid content type')
                        return resolve()
                    }
                    contentType.shift()
                    contentType = contentType.map(str => str.trim())
                    if (contentType.length === 0) {
                        error('Invalid content type')
                        return resolve()
                    }
                    contentType = contentType.map(str => str.split('='))
                    contentType = contentType.reduce((acc, [key, value]) => {
                        acc[key] = value
                        return acc
                    }, {})
                    if (contentType.boundary === undefined) {
                        error('Invalid content type')
                        return resolve()
                    }
                    readBody(response.text(), contentType.boundary)
                    resolve()
                })
                .catch(e => {
                    error(e.message)
                    resolve()
                })
            })
        }
        
        function _processQueue () {
            return new Promise((resolve) => {   
                if (GLOBALS.queue.length === 0) {
                    return resolve()
                }
                const request = {payload: {}, version: GLOBALS.version}
                let i = 0
                while (GLOBALS.queue.length > 0 && i < GLOBALS.maxGroup) {
                    const {id, ns, operation, args} = GLOBALS.queue.shift()
                    request.payload[id] = {ns, function: operation, arguments: args}
                    i++
                }
        
                excuteRequest(request)
                .then(resolve)
                .catch(e => {
                    error(e.message)
                    resolve()
                })
            })
        }
        
        function processQueue () {
            new Promise(resolve => {
                _processQueue()
                .then(_ => {
                    resolve()
                })
                .catch(e => {
                    resolve()
                })
            })
            .then(() => {
                if (GLOBALS.run === false) {
                    return
                }
                setTimeout(processQueue, GLOBALS.timeout)
            })
        }
    }.toString(),
')()'], {type: 'application/javascript'}));


/** API Code */
function PJApi () {
    if (PJApi._instance) {
        return PJApi._instance;
    }
    this.postPoned = []
    this.ww = null
    this.waits = new Map();
    this.reqid = 0
    PJApi._instance = this
}

PJApi.prototype = {
    open: function (endpoint, timeout = 80, headers = {}) {
        this.ww = new Worker(WorkerBlob);
        this.ww.onmessage = (e) => {
            const {id, result} = e.data;
            if (id == 0 || id === undefined || id === null || result === undefined || result === null) {
                console.error(result.message)
                return;
            }
            const {resolve, reject} = this.waits.get(id);
            this.waits.delete(id);
            if (result.error) {
                reject(new Error(result.message));
            } else {
                resolve(result.result);
            }
        }

        this.setEndpoint(endpoint)
        this.setTimeout(timeout)
        this.setHeaders(headers)
        this.start()
        this.postPoned.forEach(([fn, args, promise]) => {
            if (promise) {
                fn.apply(this, args).then(promise[0]).catch(promise[1])
                return
            }
            fn.apply(this, args)
        })
    },
    start: function () {
        this.ww.postMessage({start: 1})
    },
    stop: function () {
        this.ww.postMessage({stop: 1})
    },
    immediate: function (namespace, operation, args) {
        if (this.ww === null) {
            return new Promise((resolve, reject) => {
                this.postPoned.push([this.immediate, [namespace, operation, args], [resolve, reject]])
            })
        }
        return new Promise((resolve, reject) => {
            this.ww.postMessage({immediate: {id: String(++this.reqid), ns: namespace, operation: operation, args: args}});
            this.waits.set(String(this.reqid), {resolve, reject});
        })
    },
    close: function () {
        if (this.ww === null) { return }
        this.ww.terminate()
    },
    setEndpoint: function (endpoint) {
        if (this.ww === null) {
            this.postPoned.push([this.setEndpoint, [endpoint]])
            return
        }
        this.ww.postMessage({setEndpoint: {endpoint: endpoint}})
    },
    setTimeout: function (timeout) {
        if (this.ww === null) {
            this.postPoned.push([this.setTimeout, [timeout]])
            return
        }
        this.ww.postMessage({setTimeout: {timeout: timeout}})
    },
    setHeaders: function (headers) {
        if (this.ww === null) {
            this.postPoned.push([this.setHeaders, [headers]])
            return
        }
        this.ww.postMessage({setHeaders: {headers: headers}})
    },
    setMaxGrouping: function (maxGroup) {
        if (this.ww === null) {
            this.postPoned.push([this.setMaxGrouping, [maxGroup]])
            return
        }
        this.ww.postMessage({setMaxGrouping: {maxGroup: maxGroup}})
    },
    setVersion: function (version) {
        if (this.ww === null) {
            this.postPoned.push([this.setVersion, [version]])
            return
        }
        this.ww.postMessage({setVersion: {version: version}})
    },
    exec: function (namespace, operation, args) {
        if (this.ww === null) {
            return new Promise((resolve, reject) => {
                this.postPoned.push([this.exec, [namespace, operation, args]])
            })
        }
        return new Promise((resolve, reject) => {
            this.ww.postMessage({request: {id: String(++this.reqid), ns: namespace, operation: operation, args: args}});
            this.waits.set(String(this.reqid), {resolve, reject});
        })
    },
    multiple: function (requests) {
        if (this.ww === null) {
            return new Promise((resolve, reject) => {
                this.postPoned.push([this.multiple, [requests], [resolve, reject]])
            })
        }
        return new Promise((resolve, reject) => {
            Promise.allSettled(
                requests.map(request => {
                    return this.exec(request[0], request[1], request[2] ?? {})
                })
            ).then(results => {
                results = results.map(result => {
                    if (result.status === 'fulfilled') {
                        return result.value
                    } else {
                        return result.reason
                    }
                })
                resolve(results)
            })
            .catch(err => {
                reject(err)
            })
        })
    }
};
