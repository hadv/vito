import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { ethers } from 'ethers';
import { SignClient } from '@walletconnect/sign-client';

class VimApp {
  private buffer: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private inputContainer: HTMLDivElement | null;
  private helpContainer: HTMLDivElement;
  private helpScreen: HTMLDivElement;
  private mainContent: HTMLDivElement;
  private safeAddressInput: HTMLInputElement | null;
  private safeAddressDisplay: HTMLSpanElement;
  private signerAddressDisplay: HTMLSpanElement;
  private commandInput: HTMLInputElement;
  private mode: 'NORMAL' = 'NORMAL';
  private command: string = '';
  private safeAddress: string | null = null;
  private signerAddress: string | null = null;
  private socket: Socket;
  private provider: ethers.JsonRpcProvider;
  private signClient: any; // WalletConnect SignClient instance
  private sessionTopic: string | null = null; // Store the WalletConnect session topic

  constructor() {
    this.buffer = document.getElementById('buffer') as HTMLDivElement;
    this.statusBar = document.getElementById('status-bar') as HTMLDivElement;
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.helpContainer = document.getElementById('help-container') as HTMLDivElement;
    this.helpScreen = document.getElementById('help-screen') as HTMLDivElement;
    this.mainContent = document.getElementById('main-content') as HTMLDivElement;
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

    // Show help guide on initial screen
    this.showHelpGuide();
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

  private showHelpGuide(): void {
    this.helpContainer.innerHTML = '';
    this.helpScreen.innerHTML = '';

    // Help Box
    const helpBox = document.createElement('div');
    helpBox.className = 'bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-2xl shadow-lg';

    const helpTitle = document.createElement('h3');
    helpTitle.className = 'text-blue-400 font-bold mb-4';
    helpTitle.textContent = 'Help & Usage Guide';

    const commandsList = document.createElement('ul');
    commandsList.className = 'text-gray-300';

    const commands = [
      { cmd: ':c', desc: 'Connect a Safe wallet by entering its address in the input field.' },
      { cmd: ':i', desc: 'Display information about the connected Safe wallet (requires :c first).' },
      { cmd: ':wc', desc: 'Connect a signer wallet via WalletConnect to interact with the Safe (requires :c first).' },
      { cmd: ':dc', desc: 'Disconnect the current signer wallet (requires :wc first).' },
      { cmd: ':q', desc: 'Clear the buffer screen.' },
      { cmd: ':d', desc: 'Disconnect the Safe wallet and return to the input screen to connect a new Safe.' },
      { cmd: ':h', desc: 'Show this help guide with usage instructions for all commands.' },
    ];

    commands.forEach(({ cmd, desc }) => {
      const commandItem = document.createElement('li');
      commandItem.className = 'mb-2';
      commandItem.innerHTML = `<span class="text-blue-400 font-semibold">${cmd}</span> - ${desc}`;
      commandsList.appendChild(commandItem);
    });

    helpBox.appendChild(helpTitle);
    helpBox.appendChild(commandsList);

    if (this.inputContainer) {
      // If input field is visible, show help in help-container
      this.helpContainer.appendChild(helpBox);
      this.helpContainer.classList.remove('hidden');
      this.mainContent.classList.remove('hidden');
      this.buffer.classList.remove('hidden');
      this.helpScreen.classList.add('hidden');
    } else {
      // If input field is not visible, show help in help-screen
      this.helpScreen.appendChild(helpBox);
      this.helpScreen.classList.remove('hidden');
      this.mainContent.classList.add('hidden');
      this.buffer.classList.add('hidden');
    }
  }

  private async connectWallet(safeAddress: string): Promise<void> {
    try {
      this.signClient = await SignClient.init({
        projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'your_wallet_connect_project_id',
        metadata: {
          name: 'Vim Safe App',
          description: 'A minimalist Safe app with Vim-like keybindings',
          url: 'http://localhost:3000',
          icons: ['https://walletconnect.com/walletconnect-logo.png'],
        },
      });

      const { uri, approval } = await this.signClient.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_sign', 'personal_sign'],
            chains: ['eip155:1'],
            events: ['chainChanged', 'accountsChanged'],
          },
        },
      });

      if (!uri) {
        throw new Error('Failed to generate WalletConnect URI');
      }

      this.buffer.innerHTML = '';
      const text = document.createElement('p');
      text.textContent = 'Connect your wallet by scanning the QR code below:';
      text.className = 'text-center mb-2 text-gray-300';
      const canvas = document.createElement('canvas');
      canvas.className = 'mx-auto';
      this.buffer.appendChild(text);
      this.buffer.appendChild(canvas);

      await QRCode.toCanvas(canvas, uri, { width: 300 }, (err) => {
        if (err) {
          console.error('QR Code rendering error:', err);
          this.buffer.textContent = `Error generating QR code: ${err.message}`;
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        }
      });

      const session = await approval();
      this.sessionTopic = session.topic; // Store the session topic
      const address = session.namespaces.eip155.accounts[0].split(':')[2];
      this.signerAddress = address;
      const ensName = await this.resolveEnsName(address);
      this.buffer.textContent = `Connected: ${address}${ensName ? ` (${ensName})` : ''}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
      this.signerAddressDisplay.textContent = ensName ? `${ensName} (${address})` : address;
    } catch (error) {
      console.error('WalletConnect connection failed:', error);
      this.buffer.textContent = `Error connecting wallet: ${error.message}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
    }
  }

  private async disconnectWallet(): Promise<void> {
    if (this.signClient && this.sessionTopic) {
      try {
        await this.signClient.disconnect({
          topic: this.sessionTopic,
          reason: { code: 6000, message: 'User disconnected' },
        });
        this.signClient = null;
        this.sessionTopic = null;
        this.buffer.textContent = 'Wallet disconnected successfully';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-green-400';
      } catch (error) {
        console.error('WalletConnect disconnection failed:', error);
        this.buffer.textContent = `Error disconnecting wallet: ${error.message}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      }
    } else {
      this.buffer.textContent = 'No WalletConnect session to disconnect';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }

  private initSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
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

    // Clear the help screen and buffer before executing any command
    // But preserve help container if input field is visible (before :c)
    if (!this.inputContainer) {
      this.helpContainer.innerHTML = '';
      this.helpContainer.classList.add('hidden');
    }
    this.helpScreen.innerHTML = '';
    this.helpScreen.classList.add('hidden');
    this.buffer.innerHTML = '';

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
      // Adjust layout: hide main-content and help-screen, show buffer full-width
      this.mainContent.classList.add('hidden');
      this.helpContainer.innerHTML = '';
      this.helpContainer.classList.add('hidden');
      this.buffer.classList.remove('hidden');
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
      await this.connectWallet(this.safeAddress);
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
      await this.disconnectWallet();
      this.signerAddress = null;
      this.signerAddressDisplay.textContent = '';
    } else if (this.command === ':q') {
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    } else if (this.command === ':h') {
      this.showHelpGuide();
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
      const mainContentDiv = document.getElementById('main-content') as HTMLDivElement;
      mainContentDiv.insertBefore(newContainer, document.getElementById('help-container'));
      // Re-initialize references
      this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
      this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
      this.safeAddressInput.value = '';
      // Show main-content and adjust layout
      this.mainContent.classList.remove('hidden');
      this.buffer.classList.remove('hidden');
      this.helpScreen.classList.add('hidden');
      // Show help guide again after :d
      this.showHelpGuide();
    } else {
      this.buffer.textContent = `Unknown command: ${this.command}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }
}

export default VimApp;
