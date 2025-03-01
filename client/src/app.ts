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
  private mode: 'READ ONLY' | 'TX' = 'READ ONLY';
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
    this.statusBar.textContent = this.command ? `:${this.command}` : `-- ${this.mode} --`;
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

    // Mode switching section
    const modeTitle = document.createElement('h4');
    modeTitle.className = 'text-blue-400 font-semibold mt-4 mb-2';
    modeTitle.textContent = 'Mode Switching';

    const modeList = document.createElement('ul');
    modeList.className = 'text-gray-300 mb-4';
    
    const modes = [
      { key: 'e', desc: 'Switch to TX mode (requires connected wallet via :wc)' },
      { key: 'ESC', desc: 'Return to READ ONLY mode' }
    ];

    modes.forEach(({ key, desc }) => {
      const modeItem = document.createElement('li');
      modeItem.className = 'mb-2';
      modeItem.innerHTML = `<span class="text-blue-400 font-semibold">${key}</span> - ${desc}`;
      modeList.appendChild(modeItem);
    });

    // Commands section
    const commandsTitle = document.createElement('h4');
    commandsTitle.className = 'text-blue-400 font-semibold mt-4 mb-2';
    commandsTitle.textContent = 'Commands';

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
    helpBox.appendChild(modeTitle);
    helpBox.appendChild(modeList);
    helpBox.appendChild(commandsTitle);
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

      // Set up WalletConnect event listeners
      this.setupWalletConnectListeners();

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

      // Create an elegant pairing code container
      const uriContainer = document.createElement('div');
      uriContainer.className = 'mt-4 mx-auto max-w-md bg-gray-800 rounded-lg border border-gray-700 overflow-hidden shadow-lg';
      
      const uriHeader = document.createElement('div');
      uriHeader.className = 'bg-gray-700 px-4 py-2 text-gray-300 text-sm font-medium';
      uriHeader.textContent = 'Or use pairing code';
      
      const uriBody = document.createElement('div');
      uriBody.className = 'p-3 flex items-center gap-2';
      
      const uriInput = document.createElement('input');
      uriInput.readOnly = true;
      uriInput.value = uri;
      uriInput.className = 'bg-gray-900 text-gray-300 px-3 py-2 rounded flex-grow font-mono text-xs border border-gray-700 hover:border-gray-600 focus:border-blue-500 outline-none';
      
      const copyButton = document.createElement('button');
      copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>';
      copyButton.className = 'bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md flex items-center justify-center transition-colors duration-150';
      copyButton.title = 'Copy to clipboard';
      copyButton.type = 'button';
      
      copyButton.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        navigator.clipboard.writeText(uri)
          .then(() => {
            // Change button to show success state
            copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
            copyButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            copyButton.classList.add('bg-green-600', 'hover:bg-green-700');
            
            setTimeout(() => {
              // Revert button to original state
              copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>';
              copyButton.classList.remove('bg-green-600', 'hover:bg-green-700');
              copyButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
            }, 2000);
            
            // Return focus to command input
            setTimeout(() => {
              this.commandInput.focus();
            }, 100);
          })
          .catch(err => {
            console.error('Failed to copy: ', err);
            setTimeout(() => {
              this.commandInput.focus();
            }, 100);
          });
      };
      
      // Add click handler to input for better UX
      uriInput.onclick = (e) => {
        e.preventDefault();
        uriInput.select();
        setTimeout(() => {
          this.commandInput.focus();
        }, 100);
      };
      
      uriBody.appendChild(uriInput);
      uriBody.appendChild(copyButton);
      
      uriContainer.appendChild(uriHeader);
      uriContainer.appendChild(uriBody);
      
      this.buffer.appendChild(uriContainer);

      await QRCode.toCanvas(canvas, uri, { width: 300 }, (err) => {
        if (err) {
          console.error('QR Code rendering error:', err);
          this.buffer.textContent = `Error generating QR code: ${err.message}`;
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        }
      });

      try {
        const session = await approval();
        this.sessionTopic = session.topic; // Store the session topic
        const address = session.namespaces.eip155.accounts[0].split(':')[2];
        this.signerAddress = address;
        const ensName = await this.resolveEnsName(address);
        
        // Clear the buffer and show success message
        this.buffer.innerHTML = '';
        const successMessage = document.createElement('p');
        successMessage.textContent = `Connected: ${address}${ensName ? ` (${ensName})` : ''}`;
        successMessage.className = 'text-green-400';
        this.buffer.appendChild(successMessage);
        this.buffer.className = 'flex-1 p-4 overflow-y-auto';
        
        this.signerAddressDisplay.textContent = ensName ? `${ensName} (${address})` : address;
        
        // Reset command state and focus the command input
        this.command = '';
        this.updateStatus();
        
        // Ensure the command input is properly reset and focused
        this.commandInput.value = '';
        this.commandInput.blur();
        setTimeout(() => {
          this.commandInput.focus();
          console.log('Command input focused after connection');
        }, 100);
      } catch (error) {
        console.error('WalletConnect session approval failed:', error);
        this.buffer.textContent = `Error establishing session: ${error.message}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        
        // Reset command state
        this.command = '';
        this.updateStatus();
        this.commandInput.value = '';
        this.commandInput.blur();
        setTimeout(() => this.commandInput.focus(), 100);
      }
    } catch (error) {
      console.error('WalletConnect connection failed:', error);
      this.buffer.textContent = `Error connecting wallet: ${error.message}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      
      // Reset command state
      this.command = '';
      this.updateStatus();
      this.commandInput.value = '';
      this.commandInput.blur();
      setTimeout(() => this.commandInput.focus(), 100);
    }
  }

  private setupWalletConnectListeners(): void {
    if (!this.signClient) return;
    
    // Listen for session deletion events (disconnections)
    this.signClient.on('session_delete', ({ id, topic }: { id: number, topic: string }) => {
      console.log(`WalletConnect session deleted: ${topic}`);
      
      // Only handle if it's our current session
      if (this.sessionTopic === topic) {
        this.handleWalletDisconnect();
      }
    });
    
    // Listen for session expiration events
    this.signClient.on('session_expire', ({ id, topic }: { id: number, topic: string }) => {
      console.log(`WalletConnect session expired: ${topic}`);
      
      // Only handle if it's our current session
      if (this.sessionTopic === topic) {
        this.handleWalletDisconnect();
      }
    });
    
    // Listen for connection events
    this.signClient.on('session_event', (event: any) => {
      console.log('WalletConnect session event:', event);
      
      // Handle specific events like accountsChanged if needed
      if (event.name === 'accountsChanged' && this.sessionTopic === event.topic) {
        // Update connected account if it changed
        if (event.data && event.data.length > 0) {
          const newAddress = event.data[0].split(':')[2];
          if (newAddress !== this.signerAddress) {
            this.signerAddress = newAddress;
            this.updateSignerDisplay();
          }
        } else {
          // Account disconnected/switched to none
          this.handleWalletDisconnect();
        }
      }
    });
  }
  
  private async updateSignerDisplay(): Promise<void> {
    if (this.signerAddress) {
      const ensName = await this.resolveEnsName(this.signerAddress);
      this.signerAddressDisplay.textContent = ensName 
        ? `${ensName} (${this.signerAddress})` 
        : this.signerAddress;
    } else {
      this.signerAddressDisplay.textContent = '';
    }
  }
  
  private handleWalletDisconnect(): void {
    // Clear the WalletConnect session state
    this.sessionTopic = null;
    this.signerAddress = null;
    
    // Update the UI
    this.signerAddressDisplay.textContent = '';
    
    // Display a message to the user
    this.buffer.innerHTML = '';
    const disconnectMessage = document.createElement('p');
    disconnectMessage.textContent = 'Wallet disconnected';
    disconnectMessage.className = 'text-yellow-400';
    this.buffer.appendChild(disconnectMessage);
    this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    
    // Ensure command input is focused
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);
  }

  private async disconnectWallet(): Promise<void> {
    if (this.signClient && this.sessionTopic) {
      try {
        await this.signClient.disconnect({
          topic: this.sessionTopic,
          reason: { code: 6000, message: 'User disconnected' },
        });
        
        // Handle the disconnect state
        this.handleWalletDisconnect();
        
        // Add a success message
        this.buffer.innerHTML = '';
        const successMessage = document.createElement('p');
        successMessage.textContent = 'Wallet disconnected successfully';
        successMessage.className = 'text-green-400';
        this.buffer.appendChild(successMessage);
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
      // If this is a response to the 'e' key press (mode switch attempt)
      if (this.mode === 'READ ONLY' && this.signerAddress) {
        const isOwner = data.owners.map(owner => owner.toLowerCase())
          .includes(this.signerAddress!.toLowerCase());
        
        // Clear buffer before showing any message
        this.buffer.innerHTML = '';
        
        if (isOwner) {
          this.mode = 'TX';
          console.log('Switched to TX mode');
        } else {
          console.log('Cannot switch to TX mode: wallet is not an owner');
          this.buffer.textContent = 'Only Safe owners can access TX mode';
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        }
        this.updateStatus();
        return;
      }

      // Regular safeInfo display
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
    // Remove any existing listeners to prevent duplicates
    const newCommandInput = this.commandInput.cloneNode(true);
    this.commandInput.parentNode?.replaceChild(newCommandInput, this.commandInput);
    this.commandInput = newCommandInput as HTMLInputElement;
    
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
      // Get the clicked element
      const target = e.target as Element;
      
      // Check if the click is on an interactive element that should handle its own focus
      const isInteractiveElement = 
        target.tagName === 'BUTTON' || 
        target.tagName === 'INPUT' || 
        target.tagName === 'A' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA';
        
      // If we're not clicking on an interactive element, focus the command input
      if (!isInteractiveElement) {
        console.log('Clicked on non-interactive element, focusing command input');
        setTimeout(() => {
          this.commandInput.focus();
        }, 10);
      } else {
        console.log('Clicked on interactive element:', target.tagName);
      }
    });
  }

  private async handleNormalMode(e: KeyboardEvent): Promise<void> {
    console.log('Handling normal mode key:', e.key, 'Current command:', this.command);
    
    if (e.key === ':') {
      this.command = ':';
      console.log('Started command mode');
    } else if (e.key === 'e' && !this.command && this.mode === 'READ ONLY') {
      // Only allow TX mode if wallet is connected and is an owner
      if (this.signerAddress && this.safeAddress) {
        // Clear buffer before checking ownership
        this.buffer.innerHTML = '';
        
        // Use getSafeInfo to check ownership
        this.socket.emit('getSafeInfo', { safeAddress: this.safeAddress });
      } else if (!this.signerAddress) {
        // Clear buffer before showing error
        this.buffer.innerHTML = '';
        console.log('Cannot switch to TX mode: wallet not connected');
        this.buffer.textContent = 'Please connect wallet first using :wc command';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        this.updateStatus();
      } else {
        // Clear buffer before showing error
        this.buffer.innerHTML = '';
        console.log('Cannot switch to TX mode: no Safe connected');
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        this.updateStatus();
      }
    } else if (e.key === 'Escape') {
      if (this.command) {
        this.command = '';
      } else if (this.mode === 'TX') {
        this.mode = 'READ ONLY';
        console.log('Switched to READ ONLY mode');
      }
    } else if (this.command.startsWith(':')) {
      if (e.key === 'Enter') {
        console.log('Executing command:', this.command);
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
      // Force READ ONLY mode on disconnect
      this.mode = 'READ ONLY';
    } else if (this.command === ':q') {
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    } else if (this.command === ':h') {
      this.showHelpGuide();
    } else if (this.command === ':d') {
      // First disconnect wallet if connected (like :dc command)
      if (this.signerAddress && this.signClient && this.sessionTopic) {
        try {
          await this.signClient.disconnect({
            topic: this.sessionTopic,
            reason: { code: 6000, message: 'User disconnected' },
          });
        } catch (error) {
          console.error('WalletConnect disconnection failed:', error);
        }
      }
      
      // Reset all states
      this.safeAddress = null;
      this.signerAddress = null;
      this.sessionTopic = null;
      this.safeAddressDisplay.textContent = '';
      this.signerAddressDisplay.textContent = '';
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
      
      // Force READ ONLY mode
      this.mode = 'READ ONLY';
      
      // Remove existing input container
      const existingContainer = document.getElementById('input-container');
      if (existingContainer) {
        existingContainer.remove();
      }

      // Re-add the input container for new Safe connection
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
      
      // Show help guide again
      this.showHelpGuide();
    } else {
      this.buffer.textContent = `Unknown command: ${this.command}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }
}

export default VimApp;
