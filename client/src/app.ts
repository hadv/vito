import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';

class VimApp {
  private buffer: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private mode: 'NORMAL' = 'NORMAL'; // Only NORMAL mode
  private command: string = '';
  private safeAddress: string;
  private signerAddress: string | null = null;
  private socket: Socket;

  constructor() {
    this.buffer = document.getElementById('buffer') as HTMLDivElement;
    this.statusBar = document.getElementById('status-bar') as HTMLDivElement;

    console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
    console.log('VITE_SAFE_ADDRESS:', import.meta.env.VITE_SAFE_ADDRESS);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    this.safeAddress = import.meta.env.VITE_SAFE_ADDRESS || 'default_safe_address';

    console.log('Connecting to WebSocket at:', apiUrl);
    this.socket = io(apiUrl, { transports: ['websocket'] });
    this.initSocketListeners();
    this.initEventListeners();
    this.updateStatus();
  }

  private updateStatus(): void {
    this.statusBar.textContent = this.command ? `:${this.command}` : '-- NORMAL --';
  }

  private initSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    this.socket.on('walletUri', (data: { uri: string }) => {
      this.buffer.innerHTML = '';
      const text = document.createElement('p');
      text.textContent = 'Scan this QR code:';
      text.className = 'text-center mb-2';
      const canvas = document.createElement('canvas');
      canvas.className = 'mx-auto';
      this.buffer.appendChild(text);
      this.buffer.appendChild(canvas);

      QRCode.toCanvas(canvas, data.uri, { width: 200 }, (err) => {
        if (err) {
          console.error('QR Code rendering error:', err);
          this.buffer.textContent = `Error generating QR code: ${err.message}`;
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        }
      });
    });

    this.socket.on('signerAddress', (data: { address: string }) => {
      this.signerAddress = data.address;
      this.buffer.textContent = `Connected: ${this.signerAddress}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
    });

    this.socket.on('safeInfo', (data: { address: string; owners: string[]; threshold: number }) => {
      this.buffer.innerHTML = '';
      const info = document.createElement('div');
      info.className = 'text-gray-300';
      info.innerHTML = `
        <p><span class="font-bold text-blue-400">Safe Address:</span> ${data.address}</p>
        <p><span class="font-bold text-blue-400">Owners:</span> ${data.owners.join(', ')}</p>
        <p><span class="font-bold text-blue-400">Threshold:</span> ${data.threshold}</p>
      `;
      this.buffer.appendChild(info);
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    });

    this.socket.on('error', (data: { message: string }) => {
      this.buffer.textContent = `Error: ${data.message}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
    });

    this.socket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err.message);
      this.buffer.textContent = `WebSocket error: ${err.message}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
    });
  }

  private initEventListeners(): void {
    document.addEventListener('keydown', async (e: KeyboardEvent) => {
      await this.handleNormalMode(e);
    });
  }

  private async handleNormalMode(e: KeyboardEvent): Promise<void> {
    if (e.key === ':') {
      this.command = ':';
    } else if (this.command.startsWith(':')) {
      if (e.key === 'Enter') {
        await this.executeCommand();
        this.command = '';
      } else if (e.key === 'Backspace') {
        this.command = this.command.slice(0, -1);
      } else if (e.key.length === 1) {
        this.command += e.key;
      }
    }
    e.preventDefault();
    this.updateStatus();
  }

  private async executeCommand(): Promise<void> {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    if (this.command === ':walletconnect') {
      this.socket.emit('connectWallet');
    } else if (this.command === ':send') {
      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect wallet first with :walletconnect';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      const txData = {
        to: '0xRecipientAddress',
        value: '1000000000000000000',
        data: '0x',
        signerAddress: this.signerAddress,
      };
      try {
        const response = await fetch(`${apiUrl}/safe/${this.safeAddress}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(txData),
        });
        const result = await response.json();
        this.buffer.textContent = `Tx Hash: ${result.safeTxHash}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
      } catch (error) {
        this.buffer.textContent = `Error: ${error.message}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      }
    } else if (this.command === ':info') {
      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect wallet first with :walletconnect';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.socket.emit('getSafeInfo');
    } else if (this.command === ':q') {
      this.buffer.textContent = '';
    }
  }
}

export default VimApp;
