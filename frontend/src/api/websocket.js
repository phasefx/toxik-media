export class WebSocketClient {
    constructor(url = '/ws/events') {
        this.url = url;
        this.socket = null;
        this.listeners = new Set();
        this.reconnectTimer = null;
        this.isConnected = false;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const fullUrl = `${protocol}//${window.location.host}${this.url}`;

        try {
            this.socket = new WebSocket(fullUrl);

            this.socket.onopen = () => {
                console.log('WebSocket connected');
                this.isConnected = true;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type && (data.type.startsWith('ingest_') || data.type.startsWith('thumbnail_') || data.type.startsWith('job_') || data.type === 'media_imported')) {
                        console.info(`%c[Toxik WS: ${data.type}]`, 'color: #00f0ff; font-weight: bold;', data.message || data);
                    } else {
                        console.log('[Toxik WS Event]', data);
                    }
                    this.notify(data);
                } catch (e) {
                    console.error('WebSocket message parse error:', e);
                }
            };

            this.socket.onclose = () => {
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.socket.onerror = (err) => {
                console.error('WebSocket error:', err);
                this.socket.close();
            };
        } catch (e) {
            console.error('WebSocket connection attempt failed:', e);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                console.log('Reconnecting WebSocket...');
                this.connect();
            }, 3000);
        }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notify(data) {
        for (const cb of this.listeners) {
            try {
                cb(data);
            } catch (e) {
                console.error('WebSocket listener error:', e);
            }
        }
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    }
}

export const wsClient = new WebSocketClient();
