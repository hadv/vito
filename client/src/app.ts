import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { ethers } from 'ethers';

class VimApp {
  private buffer: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private inputContainer: HTMLDivElement | null;
  private safeAddressInput: HTMLInputElement | null;
  private safeAddressDisplay: HTMLSpanElement;
  private signerAddressDisplay: HTMLSpanElement;
  private commandInput: HTMLInputElement;
  private mode: 'NORMAL' = 'NORMAL';
  private command: string = '';
  private safeAddress: string | null = null;
  private signerAddress: string | null = null;
  private socket: Socket;
  private provider: ethers.BrowserProvider;

  constructor() {
    this.buffer = document.getElementById('buffer') as HTMLDivElement;
    this.statusBar = document.getElementById('status-bar') as HTMLDivElement;
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
    this.safeAddressDisplay = document.getElementById('safe-address-display') as HTMLSpanElement;
    this.signerAddressDisplay = document.getElementById('signer-address-display') as HTMLSpanElement;
    this.commandInput = document.getElementById('command-input') as HTMLInputElement;

    // Initialize Ethereum provider for ENS resolution
    const alchemyApiKey = import.meta.env.VITE_ALCHEMY_API_KEY || 'your_alchemy_api_key_here';
    this.provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`);

    console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    console.log('Connecting to WebSocket at:', apiUrl);
    this.socket = io(apiUrl, { transports: ['websocket'] });
    this.commandInput.focus();
    this.initSocketListeners();
    this.initEventListeners();
    this.updateStatus();
  }

  private async resolveEnsName(address: string): Promise<string | null> {
    try {
      const ensName = await this.provider.lookupAddress(address);
      return ensName;
    } catch (error) {
      console.error(`Failed to resolve ENS for ${address}:`, error);
      return null;
    }
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
      text.textContent = 'Connect your wallet by scanning the QR code below:';
      text.className = 'text-center mb-2 text-gray-300';
      const canvas = document.createElement('canvas');
      canvas.className = 'mx-auto';
      this.buffer.appendChild(text);
      this.buffer.appendChild(canvas);

      QRCode.toCanvas(canvas, data.uri, { width: 300 }, (err) => {
        if (err) {
          console.error('QR Code rendering error:', err);
          this.buffer.textContent = `Error generating QR code: ${err.message}`;
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        }
      });
    });

    this.socket.on('signerAddress', async (data: { address: string }) => {
      this.signerAddress = data.address;
      const ensName = await this.resolveEnsName(data.address);
      this.buffer.textContent = `Connected: ${data.address}${ensName ? ` (${ensName})` : ''}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
      this.signerAddressDisplay.textContent = ensName ? `${ensName} (${data.address})` : data.address;
    });

    this.socket.on('safeInfo', async (data: { address: string; owners: string[]; threshold: number }) => {
      this.buffer.innerHTML = '';

      // Owners Box
      const ownersBox = document.createElement('div');
      ownersBox.className = 'bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-2xl mb-4 shadow-lg';

      const ownersLabel = document.createElement('h3');
      ownersLabel.className = 'text-blue-400 font-bold mb-2';
      ownersLabel.textContent = 'Owners:';

      const ownersList = document.createElement('ul');
      ownersList.className = 'mb-4';
      for (const owner of data.owners) {
        const ensName = await this.resolveEnsName(owner);
        const ownerItem = document.createElement('li');
        ownerItem.className = 'text-gray-300';
        ownerItem.textContent = ensName ? `${owner} (${ensName})` : owner;
        ownersList.appendChild(ownerItem);
      }

      ownersBox.appendChild(ownersLabel);
      ownersBox.appendChild(ownersList);

      // Threshold Box
      const thresholdBox = document.createElement('div');
      thresholdBox.className = 'bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-2xl shadow-lg';

      const thresholdLabel = document.createElement('p');
      thresholdLabel.className = 'text-blue-400 font-bold';
      thresholdLabel.textContent = 'Threshold:';

      const thresholdValue = document.createElement('p');
      thresholdValue.className = 'text-gray-300 mb-2';
      thresholdValue.textContent = `${data.threshold} out of ${data.owners.length} signers.`;

      thresholdBox.appendChild(thresholdLabel);
      thresholdBox.appendChild(thresholdValue);

      // Append both boxes to buffer
      this.buffer.appendChild(ownersBox);
      this.buffer.appendChild(thresholdBox);
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
    this.commandInput.addEventListener('keydown', async (e: KeyboardEvent) => {
      console.log('Keydown:', e.key);
      await this.handleNormalMode(e);
    });

    this.commandInput.addEventListener('paste', async (e: ClipboardEvent) => {
      console.log('Paste event triggered');
      const pastedText = e.clipboardData?.getData('text') || '';
      console.log('Pasted text:', pastedText);
      if (this.command.startsWith(':')) {
        e.preventDefault();
        this.command += pastedText.trim();
        console.log('Updated command:', this.command);
        this.updateStatus();
      } else {
        console.log('Paste ignored: not in command mode');
      }
    });

    document.addEventListener('click', (e) => {
      if (this.inputContainer && this.safeAddressInput && e.target !== this.safeAddressInput) {
        this.commandInput.focus();
      }
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

    if (this.command === ':c') {
      const safeAddress = this.safeAddressInput!.value.trim();
      if (!ethers.isAddress(safeAddress)) {
        this.buffer.textContent = 'Please enter a valid Safe address in the input field';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.safeAddress = safeAddress;
      // Resolve ENS for the Safe address
      const ensName = await this.resolveEnsName(safeAddress);
      // Remove the existing input container if it exists
      if (this.inputContainer) {
        this.inputContainer.remove();
        this.inputContainer = null;
        this.safeAddressInput = null;
      }
      this.safeAddressDisplay.textContent = ensName ? `${ensName} (${safeAddress})` : safeAddress;
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    } else if (this.command === ':i') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.socket.emit('getSafeInfo', { safeAddress: this.safeAddress });
    } else if (this.command === ':wc') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.socket.emit('connectWallet', { safeAddress: this.safeAddress });
    } else if (this.command === ':dc') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.signerAddress) {
        this.buffer.textContent = 'No signer connected to disconnect';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.signerAddress = null;
      this.signerAddressDisplay.textContent = '';
      this.buffer.textContent = 'Signer disconnected';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
    } else if (this.command === ':q') {
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    } else if (this.command === ':d') {
      this.safeAddress = null;
      this.signerAddress = null;
      this.safeAddressDisplay.textContent = '';
      this.signerAddressDisplay.textContent = '';
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
      // Remove any existing input container to prevent duplicates
      const existingContainer = document.getElementById('input-container');
      if (existingContainer) {
        existingContainer.remove();
      }
      // Re-add the input container with the same layout as initial screen
      const newContainer = document.createElement('div');
      newContainer.id = 'input-container';
      newContainer.className = 'flex-1 p-4';
      newContainer.innerHTML = `
        <div class="bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-2xl">
          <label for="safe-address-input" class="text-gray-400 text-sm mb-2 block">Safe Account</label>
          <div class="relative w-full">
            <span class="absolute left-0 top-0 h-10 w-10 bg-gray-600 rounded-l-full flex items-center justify-center">
              <div class="w-6 h-6 bg-gray-500 rounded-full"></div>
            </span>
            <input id="safe-address-input" class="bg-gray-800 text-gray-200 pl-12 pr-4 py-2 rounded-l-full rounded-r-none focus:outline-none focus:ring-2 focus:ring-blue-400 w-full placeholder-gray-400 border border-gray-600" placeholder="" />
          </div>
        </div>
      `;
      const appDiv = document.getElementById('app') as HTMLDivElement;
      appDiv.insertBefore(newContainer, document.getElementById('command-input'));
      // Re-initialize references
      this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
      this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
      this.safeAddressInput.value = '';
    } else {
      this.buffer.textContent = `Unknown command: ${this.command}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }
}

export default VimApp;
