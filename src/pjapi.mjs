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
            maxGroup: 100000,
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
                            setTimeout(() => { GLOBALS.queue.push({id, ns, operation, args}) }, 0)
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
    
        function getChunkHeader (headers, line)
        {
            const [name, value] = line.split(':', 2)
            if (!name || !value) return;
            headers.append(name.trim().toLowerCase(), value.trim())
        }

        function readStreamChunk(chunk) {
            const lines = chunk.split("\r\n")
            let i = 0; /* split at boundary create an empty line */
            if (lines.length < 1) { return [] }
            const headers = new Headers()
            while(i < lines.length && lines[i].length > 0) {
                getChunkHeader(headers, lines[i])
                i++;
            }
            while (i < lines.length && lines[i].length == 0) {
                i++;
            }
            let j = i
            while(j < lines.length && lines[j].length > 0) {
                j++;
            }
            const responses = lines.slice(i, j)
            if (responses.length > 0) {
                for(let i = 0; i < responses.length; i++) {
                    if (!headers.get('content-type').toLocaleLowerCase().startsWith('application/json')) { continue; }
                    try {
                        const object = JSON.parse(responses[i])
                        if (object.error) { error(result.message) }
                        Object.keys(object).forEach(id => {
                            postMessage({id, result: object[id]})
                        })
                    } catch(e) {
                    }
                }
            }
        }

        function splitStreamChunk (boundary, stream)
        {
            const boundary_len = boundary.length + 2
            let leftOver = ''
            const chunks = []
            let start = 0
            while(true) {
                start = stream.indexOf(boundary)
                if (start === -1) {
                    leftOver = stream
                    break
                }
                let stop = stream.indexOf(boundary, start +  boundary_len)
                if (stop === -1) {
                    leftOver = stream
                    break
                }
                chunks.push(stream.slice(start + boundary_len, stop))
                stream = stream.slice(stop)
            }
            return [chunks, leftOver]
        }

        function readStreamBody(boundary, stream, accumulator = '') {
            return new Promise((resolve, reject) => {
                stream.read()
                .then(({value, done}) => {
                    if (!done && value.length > 0) { 
                        const text = new TextDecoder().decode(value)
                        const [chunks, leftOver] = splitStreamChunk(boundary, accumulator + text)
                        accumulator = leftOver
                        if (chunks.length > 0) {
                            for(let i = 0; i < chunks.length; i++) {
                                readStreamChunk(chunks[i])
                            }
                        }
                        
                        readStreamBody(boundary, stream, accumulator)
                        .then(_ => { resolve() })
                        .catch(e => reject(e))
                    }
                    return resolve()
                })
                .catch(e => console.log(e))
            })
        }
        
        function excuteRequest (request) {
            return new Promise(resolve => {
                fetch(GLOBALS.endpoint, 
                    {
                        method: 'POST', 
                        body: JSON.stringify(request),
                        headers: GLOBALS.headers,
                        keepalive: true,
                        priority: 'high'
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

                    readStreamBody(contentType.boundary, response.body.getReader())
                    .then(_ => {
                        resolve()
                    })
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
                    request.payload[id] = {
                        ns,
                        function: operation,
                        arguments: args
                    }
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
export default class PJApi {
    constructor() {
        this.postPoned = []
        this.ww = null
        this.waits = new Map();
        this.reqid = 0
    }

    static get instance() {
        if (!PJApi._instance) {
            PJApi._instance = new PJApi()
        }
        return PJApi._instance
    }

    open (endpoint, timeout = 80, headers = {}) {
        if (this.ww !== null) { return }
        this.ww = new Worker(WorkerBlob);
        this.ww.onmessage = (e) => {
            const {id, result} = e.data;
            if (
                    id == 0
                    || id === undefined
                    || id === null
                    || result === undefined
                    || result === null
            ) {
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
    }
    
    start () {
        this.ww.postMessage({start: 1})
    }

    stop () {
        this.ww.postMessage({stop: 1})
    }

    getRequestId() {
        return new Promise((resolve, reject) => {
            ++this.reqid
            return resolve(this.reqid.toString())
        })
    }

    immediate (namespace, operation, args) {
        if (this.ww === null) {
            return new Promise((resolve, reject) => {
                this.postPoned.push([this.immediate, [namespace, operation, args], [resolve, reject]])
            })
        }
        return new Promise((resolve, reject) => {
            this.getRequestId()
            .then(id => {
                this.ww.postMessage({immediate: {id: id, ns: namespace, operation: operation, args: args}});
                this.waits.set(id, {resolve, reject});
            })
            .catch(e => reject(e))
        })
    }
    
    close () {
        if (this.ww === null) { return }
        this.ww.terminate()
    }

    setEndpoint (endpoint) {
        if (endpoint instanceof URL) {
            endpoint = endpoint.toString()
        }
        if (this.ww === null) {
            this.postPoned.push([this.setEndpoint, [endpoint]])
            return
        }
        this.ww.postMessage({setEndpoint: {endpoint: endpoint}})
    }

    setTimeout (timeout) {
        if (this.ww === null) {
            this.postPoned.push([this.setTimeout, [timeout]])
            return
        }
        this.ww.postMessage({setTimeout: {timeout: timeout}})
    }

    setHeaders (headers) {
        if (this.ww === null) {
            this.postPoned.push([this.setHeaders, [headers]])
            return
        }
        this.ww.postMessage({setHeaders: {headers: headers}})
    }
    
    setMaxGrouping (maxGroup) {
        if (this.ww === null) {
            this.postPoned.push([this.setMaxGrouping, [maxGroup]])
            return
        }
        this.ww.postMessage({setMaxGrouping: {maxGroup: maxGroup}})
    }

    setVersion (version) {
        if (this.ww === null) {
            this.postPoned.push([this.setVersion, [version]])
            return
        }
        this.ww.postMessage({setVersion: {version: version}})
    }

    exec(namespace, operation, args = {}) {
        if (this.ww === null) {
            return new Promise((resolve, reject) => {
                this.postPoned.push([
                    this.exec,
                    [namespace, operation, args],
                    [resolve, reject]
                ])
            })
        }
        return new Promise((resolve, reject) => {
            this.getRequestId()
            .then(id => {
                this.ww.postMessage({request: {id: id, ns: namespace, operation: operation, args: args}});
                this.waits.set(id, {resolve, reject});
            })
            .catch(e => reject(e))
        })
    }

    multiple (requests) {
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