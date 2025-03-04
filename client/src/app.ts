import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { ethers } from 'ethers';
import { SignClient } from '@walletconnect/sign-client';

interface SafeInfo {
  owners: string[];
  threshold: number;
  balance: string;
  ensNames: { [address: string]: string | null };
  network?: string;
  chainId?: number;
}

interface NetworkConfig {
  name: string;
  chainId: number;
  provider: string;
  displayName: string;
}

class VimApp {
  private buffer: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private inputContainer: HTMLDivElement | null;
  private helpContainer: HTMLDivElement;
  private helpScreen: HTMLDivElement;
  private mainContent: HTMLDivElement;
  private safeAddressInput: HTMLInputElement | null;
  private networkSelect: HTMLSelectElement | null;
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
  private isModeSwitch: boolean = false;
  private cachedSafeInfo: SafeInfo | null = null;
  private selectedNetwork: NetworkConfig;
  private isConnecting: boolean = false; // Add flag to track connection state
  // Add transaction form data storage
  private txFormData: {
    to: string;
    value: string;
    data: string;
  } | null = null;

  private readonly networks: { [key: string]: NetworkConfig } = {
    mainnet: {
      name: 'mainnet',
      chainId: 1,
      provider: `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
      displayName: 'Ethereum Mainnet'
    },
    arbitrum: {
      name: 'arbitrum',
      chainId: 42161,
      provider: `https://arb-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
      displayName: 'Arbitrum One'
    },
    sepolia: {
      name: 'sepolia',
      chainId: 11155111,
      provider: `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
      displayName: 'Sepolia Testnet'
    }
  };

  constructor() {
    this.buffer = document.getElementById('buffer') as HTMLDivElement;
    this.statusBar = document.getElementById('status-bar') as HTMLDivElement;
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.helpContainer = document.getElementById('help-container') as HTMLDivElement;
    this.helpScreen = document.getElementById('help-screen') as HTMLDivElement;
    this.mainContent = document.getElementById('main-content') as HTMLDivElement;
    this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
    this.networkSelect = document.getElementById('network-select') as HTMLSelectElement;
    this.safeAddressDisplay = document.getElementById('safe-address-display') as HTMLSpanElement;
    this.signerAddressDisplay = document.getElementById('signer-address-display') as HTMLSpanElement;
    this.commandInput = document.getElementById('command-input') as HTMLInputElement;

    // Set default network to mainnet
    this.selectedNetwork = this.networks.mainnet;
    
    // Initialize Ethereum provider for the selected network
    this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);

    console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    console.log('Connecting to WebSocket at:', apiUrl);
    this.socket = io(apiUrl, { transports: ['websocket'] });
    this.commandInput.focus();
    this.initSocketListeners();
    this.initEventListeners();
    this.updateStatus();

    // Show initial input container with network selection and Safe address input
    this.showInitialInputContainer();

    // Show help guide on initial screen
    this.showHelpGuide();

    this.updateTitle();
  }

  private showInitialInputContainer(): void {
    // Remove existing input container if it exists
    const existingContainer = document.getElementById('input-container');
    if (existingContainer) {
      existingContainer.remove();
    }

    // Create new input container with network selection and Safe address input
    const newContainer = document.createElement('div');
    newContainer.id = 'input-container';
    newContainer.className = 'flex-1 p-4 max-w-full';
    newContainer.innerHTML = `
      <div class="space-y-4 sm:space-y-6">
        <div class="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div class="flex-grow relative">
            <div class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none">
              <div class="w-6 h-6 bg-gray-600 rounded-full"></div>
            </div>
            <input 
              type="text" 
              id="safe-address-input" 
              class="block pl-14 pr-2.5 py-4 w-full text-white bg-[#2c2c2c] rounded-lg border border-gray-700 appearance-none focus:outline-none focus:ring-0 focus:border-blue-600 peer text-sm sm:text-base" 
              placeholder=" "
            />
            <label 
              for="safe-address-input" 
              class="absolute text-sm text-gray-400 duration-300 transform -translate-y-6 scale-75 top-2 z-10 origin-[0] bg-[#2c2c2c] px-2 peer-focus:px-2 peer-focus:text-blue-600 left-1"
            >
              Safe Account
            </label>
          </div>
          <div class="flex-shrink-0 relative">
            <select id="network-select" class="h-[58px] w-full sm:w-36 px-3 text-white bg-[#2c2c2c] border border-gray-700 rounded-lg focus:outline-none focus:ring-0 focus:border-blue-600 appearance-none cursor-pointer text-sm sm:text-base">
              <option value="mainnet">Ethereum</option>
              <option value="arbitrum">Arbitrum</option>
              <option value="sepolia">Sepolia</option>
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
      </div>
    `;

    const mainContentDiv = document.getElementById('main-content') as HTMLDivElement;
    mainContentDiv.insertBefore(newContainer, document.getElementById('help-container'));

    // Re-initialize references
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
    this.networkSelect = document.getElementById('network-select') as HTMLSelectElement;

    // Update help container classes for mobile responsiveness
    const helpContainer = document.getElementById('help-container') as HTMLDivElement;
    helpContainer.className = 'w-full mt-4 sm:mt-0 sm:w-1/2 sm:pl-4';

    // Update main content layout for mobile responsiveness
    mainContentDiv.className = 'flex flex-col sm:flex-row w-full';

    // Update input container width for desktop
    if (this.inputContainer) {
      this.inputContainer.className = 'flex-1 p-4 max-w-full sm:w-1/2';
    }

    // Add network selection change handler
    if (this.networkSelect) {
      this.networkSelect.addEventListener('change', async (e) => {
        const selectedNetwork = (e.target as HTMLSelectElement).value;
        
        // Clear any existing Safe info cache when network changes
        this.clearSafeInfoCache();
        
        // Update network and provider
        this.selectedNetwork = this.networks[selectedNetwork];
        this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);
        
        // If a Safe is connected, verify it exists on the new network
        if (this.safeAddress) {
          try {
            // Check if the Safe exists on the new network
            const code = await this.provider.getCode(this.safeAddress);
            if (code === '0x') {
              // Safe doesn't exist on this network
              this.buffer.innerHTML = '';
              const warningMsg = document.createElement('p');
              warningMsg.textContent = `Warning: Safe ${this.safeAddress} does not exist on ${this.selectedNetwork.displayName}`;
              warningMsg.className = 'text-yellow-400';
              this.buffer.appendChild(warningMsg);
              
              // Update display to show network but indicate Safe doesn't exist
              this.safeAddressDisplay.textContent = `${this.truncateAddress(this.safeAddress)} (not deployed on ${this.selectedNetwork.displayName})`;
            } else {
              // Safe exists, load its info with network information
              await this.loadAndCacheSafeInfo();
              // Update display
              const ensName = await this.resolveEnsName(this.safeAddress);
              this.safeAddressDisplay.textContent = `${ensName ? `${ensName} (${this.truncateAddress(this.safeAddress)})` : this.truncateAddress(this.safeAddress)} on ${this.selectedNetwork.displayName}`;
            }
          } catch (error) {
            console.error('Error checking Safe on new network:', error);
            this.buffer.innerHTML = '';
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Error: Failed to verify Safe on ${this.selectedNetwork.displayName}`;
            errorMsg.className = 'text-red-500';
            this.buffer.appendChild(errorMsg);
          }
        }
      });
    }

    // Add event listeners for the Safe address input
    if (this.safeAddressInput) {
      this.safeAddressInput.addEventListener('paste', (e) => {
        setTimeout(() => {
          this.safeAddressInput!.readOnly = true;
          this.safeAddressInput!.classList.add('opacity-50', 'cursor-pointer');
          this.commandInput.focus();
        }, 10);
      });

      this.safeAddressInput.addEventListener('click', (e) => {
        if (this.safeAddressInput!.readOnly) {
          this.safeAddressInput!.readOnly = false;
          this.safeAddressInput!.classList.remove('opacity-50', 'cursor-pointer');
          this.safeAddressInput!.focus();
          e.preventDefault();
        }
      });

      this.safeAddressInput.addEventListener('focus', (e) => {
        if (this.safeAddressInput!.readOnly) {
          this.safeAddressInput!.readOnly = false;
          this.safeAddressInput!.classList.remove('opacity-50', 'cursor-pointer');
        }
      });
    }
  }

  private showNetworkSelection(): void {
    // Remove this method as it's no longer needed
    // The network selection is now handled in showInitialInputContainer
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

    // Create main container with responsive spacing
    const mainContainer = document.createElement('div');
    mainContainer.className = 'space-y-4 sm:space-y-6';

    // Mode Switching Box
    const modeBox = document.createElement('div');
    modeBox.className = 'bg-[#2c2c2c] p-4 rounded-lg border border-gray-700 shadow-lg';

    const modeLabel = document.createElement('h3');
    modeLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    modeLabel.textContent = 'Mode Switching';

    const modeList = document.createElement('ul');
    modeList.className = 'space-y-2';
    
    const modes = [
      { key: 'e', desc: 'Switch to TX mode (requires connected wallet via :wc)' },
      { key: 'ESC', desc: 'Return to READ ONLY mode' }
    ];

    modes.forEach(({ key, desc }) => {
      const modeItem = document.createElement('li');
      modeItem.className = 'text-gray-300 text-xs flex items-center gap-2';
      modeItem.innerHTML = `
        <span class="text-blue-400 font-medium w-8">${key}</span>
        <span class="text-gray-400">${desc}</span>
      `;
      modeList.appendChild(modeItem);
    });

    modeBox.appendChild(modeLabel);
    modeBox.appendChild(modeList);
    mainContainer.appendChild(modeBox);

    // Commands Box
    const commandsBox = document.createElement('div');
    commandsBox.className = 'bg-[#2c2c2c] p-4 rounded-lg border border-gray-700 shadow-lg';

    const commandsLabel = document.createElement('h3');
    commandsLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    commandsLabel.textContent = 'Commands';

    const commandsList = document.createElement('ul');
    commandsList.className = 'space-y-2';

    const commands = [
      { cmd: ':c', desc: 'Connect a Safe wallet' },
      { cmd: ':i', desc: 'Display Safe information' },
      { cmd: ':wc', desc: 'Connect a signer wallet via WalletConnect' },
      { cmd: ':dc', desc: 'Disconnect the current signer wallet' },
      { cmd: ':t', desc: 'Create a new transaction' },
      { cmd: ':l', desc: 'List pending transactions' },
      { cmd: ':q', desc: 'Clear the buffer screen' },
      { cmd: ':d', desc: 'Disconnect the Safe wallet' },
      { cmd: ':h', desc: 'Show this help guide' },
    ];

    commands.forEach(({ cmd, desc }) => {
      const commandItem = document.createElement('li');
      commandItem.className = 'text-gray-300 text-xs flex items-center gap-2';
      commandItem.innerHTML = `
        <span class="text-blue-400 font-medium w-8">${cmd}</span>
        <span class="text-gray-400">${desc}</span>
      `;
      commandsList.appendChild(commandItem);
    });

    commandsBox.appendChild(commandsLabel);
    commandsBox.appendChild(commandsList);
    mainContainer.appendChild(commandsBox);

    if (this.inputContainer) {
      // If input field is visible, show help in help-container
      this.helpContainer.appendChild(mainContainer);
      this.helpContainer.classList.remove('hidden');
      this.mainContent.classList.remove('hidden');
      this.buffer.classList.remove('hidden');
      this.helpScreen.classList.add('hidden');
      
      // Update help container classes to match input container spacing
      this.helpContainer.className = 'w-full sm:w-1/2 sm:pl-4';
    } else {
      // If input field is not visible, show help in help-screen
      this.helpScreen.appendChild(mainContainer);
      this.helpScreen.classList.remove('hidden');
      this.mainContent.classList.add('hidden');
      this.buffer.classList.add('hidden');
    }
  }

  private async connectWallet(safeAddress: string): Promise<void> {
    try {
      this.isConnecting = true;
      this.buffer.innerHTML = '';
      const loadingMsg = document.createElement('p');
      loadingMsg.textContent = 'Connecting to Safe...';
      loadingMsg.className = 'text-blue-400';
      this.buffer.appendChild(loadingMsg);

      // Validate the Safe address
      if (!ethers.isAddress(safeAddress)) {
        throw new Error('Invalid Safe address');
      }

      // Check if the Safe exists on the selected network
      const code = await this.provider.getCode(safeAddress);
      if (code === '0x') {
        throw new Error(`Safe does not exist on ${this.selectedNetwork.displayName}`);
      }

      // Store the Safe address
      this.safeAddress = safeAddress;

      // Update the Safe address display with network info
      const ensName = await this.resolveEnsName(safeAddress);
      this.safeAddressDisplay.textContent = `${ensName ? `${ensName} (${this.truncateAddress(safeAddress)})` : this.truncateAddress(safeAddress)} on ${this.selectedNetwork.displayName}`;

      // Load and cache Safe info for the selected network
      await this.loadAndCacheSafeInfo();

      // Remove the input container
      if (this.inputContainer) {
        this.inputContainer.remove();
        this.inputContainer = null;
        this.safeAddressInput = null;
        this.networkSelect = null;
      }

      // Update status bar
      this.updateStatus();
        
        // Clear the buffer and show success message
        this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = `Connected to Safe on ${this.selectedNetwork.displayName}`;
      successMsg.className = 'text-green-400';
      this.buffer.appendChild(successMsg);

    } catch (error: unknown) {
      console.error('Failed to connect to Safe:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      throw error;
    } finally {
      this.isConnecting = false;
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
        ? `${ensName} (${this.truncateAddress(this.signerAddress)})` 
        : this.truncateAddress(this.signerAddress);
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
      } catch (error: unknown) {
        console.error('WalletConnect disconnection failed:', error);
        this.buffer.textContent = `Error disconnecting wallet: ${error instanceof Error ? error.message : 'Unknown error'}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      }
    } else {
      this.buffer.textContent = 'No WalletConnect session to disconnect';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }

  private initSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.updateStatus();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.updateStatus();
    });

    this.socket.on('safeInfo', async (data: { address: string; owners: string[]; threshold: number; chainId?: number }) => {
      // Skip if we're in the process of connecting
      if (this.isConnecting) return;

      try {
        // If chainId is provided in the response, verify it matches the selected network
        if (data.chainId !== undefined && data.chainId !== this.selectedNetwork.chainId) {
          console.warn(`Received Safe info from different network (Chain ID: ${data.chainId})`);
          return;
        }

        // Resolve ENS names for all owners using the current network's provider
        const ensNames: { [address: string]: string | null } = {};
      for (const owner of data.owners) {
          ensNames[owner] = await this.resolveEnsName(owner);
        }

        // Cache the data with network information
        this.cachedSafeInfo = {
          owners: data.owners,
          threshold: data.threshold,
          balance: '0', // We'll update this when needed
          ensNames,
          network: this.selectedNetwork.name,
          chainId: this.selectedNetwork.chainId
        };

        // Display the info
        this.displaySafeInfo(this.cachedSafeInfo);
      } catch (error) {
        console.error('Error processing Safe info:', error);
      }
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.updateStatus();
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

    if (this.safeAddressInput) {
      this.safeAddressInput.addEventListener('paste', (e) => {
        setTimeout(() => {
          this.safeAddressInput!.readOnly = true;
          this.safeAddressInput!.classList.add('opacity-50', 'cursor-pointer');
          this.commandInput.focus();
        }, 10);
      });

      this.safeAddressInput.addEventListener('click', (e) => {
        if (this.safeAddressInput!.readOnly) {
          this.safeAddressInput!.readOnly = false;
          this.safeAddressInput!.classList.remove('opacity-50', 'cursor-pointer');
          this.safeAddressInput!.focus();
          e.preventDefault();
        }
      });

      this.safeAddressInput.addEventListener('focus', (e) => {
        if (this.safeAddressInput!.readOnly) {
          this.safeAddressInput!.readOnly = false;
          this.safeAddressInput!.classList.remove('opacity-50', 'cursor-pointer');
        }
      });
    }
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
        
        // Set flag for mode switch attempt
        this.isModeSwitch = true;
        
        // Check if the signer is an owner
        if (this.cachedSafeInfo && this.cachedSafeInfo.owners.includes(this.signerAddress)) {
          // Signer is an owner, switch to TX mode
          this.mode = 'TX';
          console.log('Switched to TX mode');
          this.updateStatus();
        } else {
          // Signer is not an owner
          console.log('Cannot switch to TX mode: signer is not an owner');
          this.buffer.textContent = 'Error: Connected wallet is not an owner of this Safe';
          this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
        }
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
      if (!this.safeAddressInput) {
        this.buffer.textContent = 'Please enter a Safe address in the input field';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      const safeAddress = this.safeAddressInput.value.trim();
      if (!safeAddress) {
        this.buffer.textContent = 'Please enter a Safe address in the input field';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      if (!ethers.isAddress(safeAddress)) {
        this.buffer.textContent = 'Please enter a valid Safe address in the input field';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      // Set connecting flag
      this.isConnecting = true;

      try {
        // Clear any existing Safe info cache
        this.clearSafeInfoCache();
        
        // Update the provider to use the selected network
        this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);
        
        // Connect to the Safe with the current network
        await this.connectWallet(safeAddress);
        
        // Remove the input container
      if (this.inputContainer) {
        this.inputContainer.remove();
        this.inputContainer = null;
        this.safeAddressInput = null;
          this.networkSelect = null;
        }
        
        // Clear the buffer
        this.buffer.innerHTML = '';
      } catch (error) {
        console.error('Failed to connect to Safe:', error);
        this.buffer.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      } finally {
        this.isConnecting = false;
      }
    } else if (this.command === ':wc') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      try {
        // Initialize WalletConnect with the selected network's chain ID
        await this.initializeWalletConnect(this.selectedNetwork.chainId);
      } catch (error) {
        console.error('Failed to initialize WalletConnect:', error);
        this.buffer.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      }
    } else if (this.command === ':d') {
      // Clear all state
      this.safeAddress = null;
      this.signerAddress = null;
      this.sessionTopic = null;
      this.cachedSafeInfo = null;
      this.txFormData = null;
      this.mode = 'READ ONLY';
      
      // Reset network to mainnet
      this.selectedNetwork = this.networks.mainnet;
      this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);
      
      // Clear displays
      this.safeAddressDisplay.textContent = '';
      this.signerAddressDisplay.textContent = '';
      
      // Show initial input container
      this.showInitialInputContainer();
      
      // Reset network select to mainnet if it exists
      if (this.networkSelect) {
        this.networkSelect.value = 'mainnet';
      }
      
      // Show help guide
      this.showHelpGuide();
      
      // Update status
      this.updateStatus();
      
      // Clear buffer
      this.buffer.innerHTML = '';
      
      // Focus command input
      setTimeout(() => {
        this.commandInput.focus();
      }, 100);
    } else if (this.command === ':i') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      try {
        // Load and display Safe info
        await this.loadAndCacheSafeInfo();
        if (this.cachedSafeInfo) {
          this.displaySafeInfo(this.cachedSafeInfo);
        }
      } catch (error) {
        console.error('Failed to display Safe info:', error);
        this.buffer.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      }
    } else if (this.command === ':h') {
      // Show help guide
      this.showHelpGuide();
    } else if (this.command === ':t') {
      if (this.mode !== 'TX') {
        this.buffer.textContent = 'Please switch to TX mode first by pressing "e" key';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect wallet with :wc first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      this.showTransactionScreen();
    } else if (this.command === ':p') {
      if (this.mode !== 'TX') {
        this.buffer.textContent = 'Please switch to TX mode first by pressing "e" key';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect wallet with :wc first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      await this.prepareAndSignTransaction();
    } else if (this.command === ':dc') {
      if (!this.signerAddress) {
        this.buffer.textContent = 'No wallet connected to disconnect';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      await this.disconnectWallet();
    } else if (this.command === ':q') {
      // Clear the buffer
      this.buffer.innerHTML = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    } else if (this.command === ':s') {
      if (this.mode !== 'TX') {
        this.buffer.textContent = 'Please switch to TX mode first by pressing "e" key';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect wallet with :wc first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }
      // We need a safeTxHash parameter here
      this.buffer.textContent = 'Please provide a transaction hash to sign';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
      return;
    } else {
      this.buffer.textContent = `Unknown command: ${this.command}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
    }
  }

  private showTransactionScreen(): void {
    // Clear existing content
    this.buffer.innerHTML = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';

    // Create transaction form container
    const formContainer = document.createElement('div');
    formContainer.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';

    // Create form title
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-6';
    title.textContent = 'New Transaction';

    // Create form
    const form = document.createElement('form');
    form.className = 'space-y-6';
    form.id = 'transaction-form';
    form.onsubmit = (e) => {
      e.preventDefault();
      // Handle form submission here
      const to = (form.querySelector('#tx-to') as HTMLInputElement).value;
      const value = (form.querySelector('#tx-value') as HTMLInputElement).value;
      const data = (form.querySelector('#tx-data') as HTMLTextAreaElement).value;

      // Store form data in class variable
      this.txFormData = { to, value, data };
      console.log('Transaction form data stored:', this.txFormData);

      // Show success message
      const successMsg = document.createElement('div');
      successMsg.className = 'mt-4 p-3 bg-green-800 text-white rounded';
      successMsg.textContent = 'Transaction data saved. Use :p to prepare and sign.';
      formContainer.appendChild(successMsg);

      // Convert BigInt to string before emitting
      const parsedValue = value ? ethers.parseEther(value) : 0n;
      this.socket.emit('prepareTransaction', {
        safeAddress: this.safeAddress,
        transaction: {
          to,
          value: parsedValue.toString(), // Convert BigInt to string
          data: data || '0x',
        },
        network: this.selectedNetwork.name,
        chainId: this.selectedNetwork.chainId,
        provider: this.selectedNetwork.provider
      });
    };

    // Create form fields
    const fields = [
      {
        id: 'tx-to',
        label: 'To Address',
        type: 'text',
        placeholder: '0x...',
        required: true
      },
      {
        id: 'tx-value',
        label: 'Value (ETH)',
        type: 'text',
        placeholder: '0.0',
        step: '0.1',
        min: '0'
      },
      {
        id: 'tx-data',
        label: 'Data (hex)',
        type: 'textarea',
        placeholder: '0x...',
        rows: 4 as number
      }
    ];

    fields.forEach(field => {
      const fieldContainer = document.createElement('div');
      fieldContainer.className = 'relative';

      const label = document.createElement('label');
      label.htmlFor = field.id;
      label.className = 'block text-sm font-medium text-gray-300 mb-1';
      label.textContent = field.label;

      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = field.rows as number;
      } else {
        input = document.createElement('input');
        input.type = field.type;
        if (field.step) input.step = field.step;
        if (field.min) input.min = field.min;
      }

      input.id = field.id;
      input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
      input.placeholder = field.placeholder;
      if (field.required) input.required = true;

      // Pre-fill with stored data if available
      if (this.txFormData) {
        if (field.id === 'tx-to') {
          (input as HTMLInputElement).value = this.txFormData.to || '';
        } else if (field.id === 'tx-value') {
          (input as HTMLInputElement).value = this.txFormData.value || '';
        } else if (field.id === 'tx-data') {
          (input as HTMLTextAreaElement).value = this.txFormData.data || '';
        }
      }

      // Configure decimal handling for ETH value input
      if (field.id === 'tx-value') {
        // Create a container for label and balance info
        const labelContainer = document.createElement('div');
        labelContainer.className = 'flex items-center justify-between mb-1';
        
        // Move the label to the container
        label.className = 'text-sm font-medium text-gray-300';
        
        // Create a container for MAX button and balance
        const rightContainer = document.createElement('div');
        rightContainer.className = 'flex items-center gap-2';
        
        // Create MAX button
        const maxButton = document.createElement('button');
        maxButton.type = 'button';
        maxButton.className = 'px-2 py-0.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500';
        maxButton.textContent = 'MAX';
        
        // Create balance display
        const balanceDisplay = document.createElement('div');
        balanceDisplay.className = 'text-xs text-gray-400';
        balanceDisplay.id = 'safe-balance';
        balanceDisplay.textContent = 'Loading...';
        
        // Add input configuration
        input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
        input.setAttribute('pattern', '[0-9]*(.[0-9]+)?');
        input.setAttribute('inputmode', 'decimal');
        (input as HTMLInputElement).setAttribute('lang', 'en');
        (input as HTMLInputElement).setAttribute('data-type', 'number');
        
        // Use cached balance if available
        if (this.cachedSafeInfo) {
          balanceDisplay.textContent = `${this.cachedSafeInfo.balance} ETH`;
          maxButton.onclick = () => {
            (input as HTMLInputElement).value = this.cachedSafeInfo!.balance;
          };
        } else {
          // Fallback to fetching if cache is empty
          this.provider.getBalance(this.safeAddress!).then(balance => {
            const balanceInEth = ethers.formatEther(balance);
            balanceDisplay.textContent = `${balanceInEth} ETH`;
            maxButton.onclick = () => {
              (input as HTMLInputElement).value = balanceInEth;
            };
          }).catch(err => {
            console.error('Failed to fetch balance:', err);
            balanceDisplay.textContent = 'Error';
          });
        }

        // Add input event listener to format decimal values
        input.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          let value = target.value;
          
          // Remove any non-numeric characters except decimal point
          value = value.replace(/[^\d.]/g, '');
          
          // Ensure only one decimal point
          const parts = value.split('.');
          if (parts.length > 2) {
            value = parts[0] + '.' + parts.slice(1).join('');
          }
          
          // Update the input value
          target.value = value;
        });

        // Assemble the components
        rightContainer.appendChild(balanceDisplay);
        rightContainer.appendChild(maxButton);
        labelContainer.appendChild(label);
        labelContainer.appendChild(rightContainer);
        
        fieldContainer.appendChild(labelContainer);
        fieldContainer.appendChild(input);
      } else if (field.id === 'tx-to') {
        // Create a wrapper for the address input and dropdown
        const addressWrapper = document.createElement('div');
        addressWrapper.className = 'relative';
        
        // Create datalist container that will be styled as a dropdown
        const ownersDropdown = document.createElement('div');
        ownersDropdown.className = 'hidden absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto';
        ownersDropdown.id = 'owners-dropdown';
        
        // Configure input
        input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
        input.autocomplete = 'off';
        
        // Add input event listeners for custom dropdown behavior
        input.addEventListener('focus', () => {
          const ownersDropdown = document.getElementById('owners-dropdown');
          if (ownersDropdown && this.cachedSafeInfo) {
            // Use cached data for owners dropdown
            ownersDropdown.innerHTML = '';
            ownersDropdown.classList.remove('hidden');
            
            for (const owner of this.cachedSafeInfo.owners) {
              const option = document.createElement('div');
              option.className = 'px-4 py-2 text-white hover:bg-gray-600 cursor-pointer transition-colors duration-150';
              
              const ensName = this.cachedSafeInfo.ensNames[owner];
              if (ensName) {
                option.innerHTML = `
                  <div class="text-sm font-medium text-blue-400">${ensName}</div>
                  <div class="text-xs text-gray-400 font-mono">${owner}</div>
                `;
              } else {
                option.innerHTML = `<div class="text-sm font-mono">${owner}</div>`;
              }
              
              
              option.addEventListener('click', () => {
                const input = document.getElementById('tx-to') as HTMLInputElement;
                if (input) {
                  input.value = owner;
                  ownersDropdown.classList.add('hidden');
                  input.focus();
                }
              });
              
              ownersDropdown.appendChild(option);
            }
          } else {
            // Fallback to fetching if cache is empty
            ownersDropdown?.classList.remove('hidden');
            this.socket.emit('getSafeInfo', { safeAddress: this.safeAddress });
          }
        });
        
        input.addEventListener('blur', () => {
          // Delay hiding to allow for click events on the dropdown
          setTimeout(() => {
            ownersDropdown.classList.add('hidden');
          }, 200);
        });
        
        input.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          const value = target.value.toLowerCase();
          
          // Show/hide options based on input
          Array.from(ownersDropdown.children).forEach((option: Element) => {
            const text = option.textContent?.toLowerCase() || '';
            if (text.includes(value) || value === '') {
              (option as HTMLElement).style.display = 'block';
            } else {
              (option as HTMLElement).style.display = 'none';
            }
          });
          
          ownersDropdown.classList.remove('hidden');
        });
        
        // Assemble the components
        fieldContainer.appendChild(label);
        addressWrapper.appendChild(input);
        addressWrapper.appendChild(ownersDropdown);
        fieldContainer.appendChild(addressWrapper);
      } else {
        fieldContainer.appendChild(label);
        fieldContainer.appendChild(input);
      }
      form.appendChild(fieldContainer);
    });

    // Add submit button
    const submitButtonContainer = document.createElement('div');
    submitButtonContainer.className = 'mt-6';
    
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors duration-200';
    submitButton.textContent = 'Save Transaction';
    
    submitButtonContainer.appendChild(submitButton);
    form.appendChild(submitButtonContainer);

    // Assemble the form
    formContainer.appendChild(title);
    formContainer.appendChild(form);
    this.buffer.appendChild(formContainer);
  }

  private async prepareAndSignTransaction(): Promise<void> {
    try {
      console.log('Current txFormData:', this.txFormData);
      
      // Check if we have form data stored
      if (!this.txFormData) {
        // Try to get transaction details from form if it exists
        const toInput = document.getElementById('tx-to') as HTMLInputElement;
        const valueInput = document.getElementById('tx-value') as HTMLInputElement;
        const dataInput = document.getElementById('tx-data') as HTMLTextAreaElement;

        if (toInput && valueInput && dataInput) {
          console.log('Found form elements:', { to: toInput.value, value: valueInput.value, data: dataInput.value });
          this.txFormData = {
            to: toInput.value,
            value: valueInput.value,
            data: dataInput.value
          };
        } else {
          // No form data available
          this.buffer.innerHTML = '';
          const errorMsg = document.createElement('div');
          errorMsg.innerHTML = `
            <p class="text-yellow-400 mb-4">No transaction data found. Please create a transaction with :t first.</p>
            <p class="text-gray-400">Steps to create a transaction:</p>
            <ol class="list-decimal list-inside text-gray-400 ml-4 mt-2">
              <li>Type :t to open the transaction form</li>
              <li>Fill in the required fields</li>
              <li>Click the "Save Transaction" button</li>
              <li>Then use :p to prepare and sign the transaction</li>
            </ol>
          `;
          this.buffer.appendChild(errorMsg);
          return;
        }
      }

      const { to: toAddress, value, data } = this.txFormData;
      console.log('Using transaction data:', { toAddress, value, data });

      if (!toAddress) {
        throw new Error('To address is required');
      }

      if (!ethers.isAddress(toAddress)) {
        throw new Error('Invalid to address');
      }

      // Show preparing message
      this.buffer.innerHTML = '';
      const preparingMsg = document.createElement('p');
      preparingMsg.textContent = 'Preparing transaction...';
      preparingMsg.className = 'text-blue-400';
      this.buffer.appendChild(preparingMsg);

      // Get the current nonce from the Safe contract
      const safeContract = new ethers.Contract(
        this.safeAddress!,
        ['function nonce() view returns (uint256)'],
        this.provider
      );
      const nonce = await safeContract.nonce();

      // Create the Safe transaction data
      const valueInWei = value ? ethers.parseEther(value) : 0n;
      const safeTx = {
        to: toAddress,
        value: valueInWei.toString(),
        data: data || '0x',
        operation: 0, // Call operation
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: '0x0000000000000000000000000000000000000000',
        refundReceiver: '0x0000000000000000000000000000000000000000',
        nonce: nonce.toString()
      };

      // Create the domain data for EIP-712 signing
      const domain = {
        chainId: this.selectedNetwork.chainId, // Use selected network's chainId
        verifyingContract: this.safeAddress
      };

      // Define the types for EIP-712 signing
      const types = {
        SafeTx: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
          { name: 'safeTxGas', type: 'uint256' },
          { name: 'baseGas', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'gasToken', type: 'address' },
          { name: 'refundReceiver', type: 'address' },
          { name: 'nonce', type: 'uint256' }
        ]
      };

      // Create the typed data for signing
      const typedData = {
        types,
        primaryType: 'SafeTx',
        domain,
        message: safeTx
      };

      // Show signing message
      const signingMsg = document.createElement('p');
      signingMsg.textContent = 'Please sign the transaction...';
      signingMsg.className = 'text-blue-400 mt-4';
      this.buffer.appendChild(signingMsg);

      console.log('Requesting signature with typed data:', JSON.stringify(typedData, null, 2));

      // Request signature using WalletConnect v2
      const signature = await this.signClient.request({
        topic: this.sessionTopic!,
        chainId: `eip155:${this.selectedNetwork.chainId}`, // Use selected network's chainId
        request: {
          method: 'eth_signTypedData_v4',
          params: [
            this.signerAddress!.toLowerCase(),
            JSON.stringify(typedData)
          ]
        }
      });

      console.log('Received signature:', signature);

      // Calculate safeTxHash
      const abiCoder = new ethers.AbiCoder();
      const encodedData = abiCoder.encode(
        ['address', 'uint256', 'bytes', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
        [safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas, safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver, safeTx.nonce]
      );
      const safeTxHash = ethers.keccak256(encodedData);

      // Submit signature to the backend with network information
      await new Promise<void>((resolve, reject) => {
        const socket = this.socket;
        
        function cleanup() {
          clearTimeout(timeout);
          socket.off('signatureSubmitted');
          socket.off('error');
        }
        
        socket.once('signatureSubmitted', () => {
          cleanup();
          resolve();
        });
        
        socket.once('error', (error: unknown) => {
          cleanup();
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(errorMessage));
        });
        
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Signature submission timed out'));
        }, 30000);
        
        // Emit the event with network information
        socket.emit('submitSignature', {
          safeAddress: this.safeAddress,
          safeTxHash,
          signature,
          transaction: safeTx,
          signerAddress: this.signerAddress,
          network: this.selectedNetwork.name,
          chainId: this.selectedNetwork.chainId
        });
      });

      // Show success message
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = 'Transaction signed successfully!';
      successMsg.className = 'text-green-400';
      this.buffer.appendChild(successMsg);

      // Refresh the transaction list after a short delay
      setTimeout(() => {
        this.command = ':l';
        this.executeCommand();
      }, 2000);

    } catch (error: unknown) {
      console.error('Transaction preparation/signing failed:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
    }
  }

  private async executeTransaction(safeTxHash: string): Promise<void> {
    try {
      this.buffer.innerHTML = '';
      const executingMsg = document.createElement('p');
      executingMsg.textContent = 'Executing transaction...';
      executingMsg.className = 'text-blue-400';
      this.buffer.appendChild(executingMsg);

      // Execute transaction using Socket.IO
      const executionPromise = new Promise<any>((resolve, reject) => {
        // Set up one-time listener for the response
        this.socket.once('transactionExecuted', (data: any) => {
          resolve(data);
        });

        // Set up error handler
        this.socket.once('error', (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(errorMessage));
        });

        // Set timeout
        const timeout = setTimeout(() => {
          reject(new Error('Request timed out'));
        }, 30000); // Longer timeout for execution

        // Clean up on resolve/reject
        const cleanup = () => {
          clearTimeout(timeout);
          this.socket.off('transactionExecuted');
          this.socket.off('error');
        };

        Promise.resolve(executionPromise).then(cleanup, cleanup);

        // Emit the event to execute transaction
        this.socket.emit('executeTransaction', {
          safeAddress: this.safeAddress,
          safeTxHash
        });
      });

      // Wait for the response
      const result = await executionPromise;

      // Show final success message
      this.buffer.innerHTML = '';
      const finalMsg = document.createElement('div');
      finalMsg.className = 'space-y-4';
      finalMsg.innerHTML = `
        <p class="text-green-400">Transaction executed successfully!</p>
        <p class="text-gray-300">Transaction hash: ${result.txHash}</p>
        <p class="text-gray-300">You can track your transaction on Etherscan:</p>
        <a href="https://etherscan.io/tx/${result.txHash}" target="_blank" rel="noopener noreferrer" 
           class="text-blue-400 hover:text-blue-300 underline">
          View on Etherscan
        </a>
      `;
      this.buffer.appendChild(finalMsg);

      // Refresh the transaction list after a short delay
      setTimeout(() => {
        this.command = ':l';
        this.executeCommand();
      }, 5000);

    } catch (error: unknown) {
      console.error('Transaction execution failed:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
    }
  }

  private async signTransaction(safeTxHash: string): Promise<void> {
    try {
      // Show signing message
      this.buffer.innerHTML = '';
      const signingMsg = document.createElement('p');
      signingMsg.textContent = 'Please sign the transaction...';
      signingMsg.className = 'text-blue-400';
      this.buffer.appendChild(signingMsg);

      // Get transaction details using Socket.IO
      const txDetailsPromise = new Promise<any>((resolve, reject) => {
        // Set up one-time listener for the response
        this.socket.once('transactionDetails', (data: any) => {
          resolve(data);
        });

        // Set up error handler
        this.socket.once('error', (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(errorMessage));
        });

        // Set timeout
        const timeout = setTimeout(() => {
          reject(new Error('Request timed out'));
        }, 10000);

        // Clean up on resolve/reject
        const cleanup = () => {
          clearTimeout(timeout);
          this.socket.off('transactionDetails');
          this.socket.off('error');
        };

        Promise.resolve(txDetailsPromise).then(cleanup, cleanup);

        // Emit the event to get transaction details
        this.socket.emit('getTransactionDetails', { safeTxHash });
      });

      // Wait for the response
      const txDetails = await txDetailsPromise;

      // Request signature using WalletConnect
      if (!this.signClient || !this.sessionTopic) {
        throw new Error('WalletConnect session not found');
      }

      // Request signature
      const signature = await this.signClient.request({
        topic: this.sessionTopic,
        chainId: 'eip155:1',
        request: {
          method: 'eth_signTypedData_v4',
          params: [
            this.signerAddress,
            txDetails.typedData
          ]
        }
      });

      // Submit signature using Socket.IO
      const signatureSubmittedPromise = new Promise<any>((resolve, reject) => {
        // Set up one-time listener for the response
        this.socket.once('signatureSubmitted', (data: any) => {
          resolve(data);
        });
        
        // Set up error handler
        this.socket.once('error', (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(errorMessage));
        });
        
        // Set timeout
        const timeout = setTimeout(() => {
          reject(new Error('Request timed out'));
        }, 10000);
        
        // Clean up on resolve/reject
        const cleanup = () => {
          clearTimeout(timeout);
          this.socket.off('signatureSubmitted');
          this.socket.off('error');
        };
        
        Promise.resolve(signatureSubmittedPromise).then(cleanup, cleanup);
        
        // Emit the event to submit signature
        this.socket.emit('submitSignature', {
          safeAddress: this.safeAddress,
          safeTxHash,
          signature,
          signerAddress: this.signerAddress
        });
      });

      // Wait for the response
      await signatureSubmittedPromise;

      // Show success message and refresh transaction list
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = 'Transaction signed successfully!';
      successMsg.className = 'text-green-400';
      this.buffer.appendChild(successMsg);

      // Refresh the transaction list after a short delay
      setTimeout(() => {
        this.command = ':l';
        this.executeCommand();
      }, 2000);

    } catch (error: unknown) {
      console.error('Error signing transaction:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
    }
  }

  private updateTitle() {
    document.title = `Minimalist Safe{Wallet}`;
  }

  private truncateAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }

  private async loadAndCacheSafeInfo(): Promise<void> {
    if (!this.safeAddress) return;

    try {
      // Clear any existing cache first to avoid stale data
      this.cachedSafeInfo = null;

      // First check if the Safe exists on the selected network by checking its code
      const code = await this.provider.getCode(this.safeAddress);
      if (code === '0x') {
        throw new Error(`Safe does not exist on ${this.selectedNetwork.displayName}`);
      }

      // Fetch balance using the current network's provider
      const balance = await this.provider.getBalance(this.safeAddress);
      const balanceInEth = ethers.formatEther(balance);

      // Create a promise to handle the socket response
      return new Promise((resolve, reject) => {
        // Set up a timeout
        const timeout = setTimeout(() => {
          this.socket.off('safeInfo');
          reject(new Error('Safe info request timed out'));
        }, 10000);

        // Emit getSafeInfo with network information
        this.socket.emit('getSafeInfo', { 
          safeAddress: this.safeAddress,
          network: this.selectedNetwork.name,
          chainId: this.selectedNetwork.chainId,
          provider: this.selectedNetwork.provider // Add the provider URL to ensure backend uses correct network
        });
        
        // One-time listener for the response
        this.socket.once('safeInfo', async (data: { address: string; owners: string[]; threshold: number; chainId?: number }) => {
          clearTimeout(timeout);
          
          try {
            // If chainId is provided in the response, verify it matches the selected network
            if (data.chainId !== undefined && data.chainId !== this.selectedNetwork.chainId) {
              throw new Error(`Safe info is from a different network (Chain ID: ${data.chainId})`);
            }

            // Resolve ENS names for all owners using the current network's provider
            const ensNames: { [address: string]: string | null } = {};
            for (const owner of data.owners) {
              ensNames[owner] = await this.resolveEnsName(owner);
            }

            // Cache the data with network information
            this.cachedSafeInfo = {
              owners: data.owners,
              threshold: data.threshold,
              balance: balanceInEth,
              ensNames,
              network: this.selectedNetwork.name,
              chainId: this.selectedNetwork.chainId
            };

            resolve();
          } catch (error) {
            reject(error);
          }
        });

        // Handle errors
        this.socket.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error: unknown) {
      console.error('Failed to load Safe info:', error);
      // Clear any cached data since the Safe doesn't exist on this network
      this.clearSafeInfoCache();
      // Show error in buffer
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      throw error;
    }
  }

  private clearSafeInfoCache(): void {
    // Clear all cached data
    this.cachedSafeInfo = null;
    this.txFormData = null;
    
    // Clear any displayed Safe info from the buffer
    if (this.buffer.textContent?.includes('Owners:') || this.buffer.textContent?.includes('Threshold:')) {
      this.buffer.textContent = '';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    }
  }

  private displaySafeInfo(info: SafeInfo): void {
    // First verify that the cached info matches current network
    if (this.cachedSafeInfo && 
        (this.cachedSafeInfo.network !== this.selectedNetwork.name || 
         this.cachedSafeInfo.chainId !== this.selectedNetwork.chainId)) {
      // If network mismatch, clear cache and reload
      this.clearSafeInfoCache();
      this.loadAndCacheSafeInfo().then(() => {
        if (this.cachedSafeInfo) {
          this.displaySafeInfo(this.cachedSafeInfo);
        }
      });
      return;
    }

    // Clear the buffer and ensure proper layout
    this.buffer.innerHTML = '';
    this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    this.mainContent.classList.add('hidden');
    this.helpContainer.innerHTML = '';
    this.helpContainer.classList.add('hidden');
    this.helpScreen.innerHTML = '';
    this.helpScreen.classList.add('hidden');

    // Create main container with responsive spacing
    const mainContainer = document.createElement('div');
    mainContainer.className = 'w-full space-y-4 sm:space-y-6';

    // Network Info Box
    const networkBox = document.createElement('div');
    networkBox.className = 'bg-[#2c2c2c] p-4 sm:p-6 rounded-lg border border-gray-700 w-full shadow-lg';

    const networkLabel = document.createElement('h3');
    networkLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    networkLabel.textContent = 'Network:';

    const networkValue = document.createElement('p');
    networkValue.className = 'text-gray-300 text-xs';
    networkValue.textContent = this.selectedNetwork.displayName;

    networkBox.appendChild(networkLabel);
    networkBox.appendChild(networkValue);
    mainContainer.appendChild(networkBox);

    // Owners Box
    const ownersBox = document.createElement('div');
    ownersBox.className = 'bg-[#2c2c2c] p-4 sm:p-6 rounded-lg border border-gray-700 w-full shadow-lg';

    const ownersLabel = document.createElement('h3');
    ownersLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    ownersLabel.textContent = 'Owners:';

    const ownersList = document.createElement('ul');
    ownersList.className = 'space-y-2';
    for (const owner of info.owners) {
      const ensName = info.ensNames[owner];
      const ownerItem = document.createElement('li');
      ownerItem.className = 'text-gray-300 text-xs';
      if (ensName) {
        ownerItem.innerHTML = `
          <div class="text-blue-400 font-medium">${ensName}</div>
          <div class="text-gray-400 font-mono break-all">${owner}</div>
        `;
      } else {
        ownerItem.innerHTML = `<div class="font-mono break-all">${owner}</div>`;
      }
      ownersList.appendChild(ownerItem);
    }

    ownersBox.appendChild(ownersLabel);
    ownersBox.appendChild(ownersList);
    mainContainer.appendChild(ownersBox);

    // Threshold Box
    const thresholdBox = document.createElement('div');
    thresholdBox.className = 'bg-[#2c2c2c] p-4 sm:p-6 rounded-lg border border-gray-700 w-full shadow-lg';

    const thresholdLabel = document.createElement('p');
    thresholdLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    thresholdLabel.textContent = 'Threshold:';

    const thresholdValue = document.createElement('p');
    thresholdValue.className = 'text-gray-300 text-xs';
    thresholdValue.textContent = `${info.threshold} out of ${info.owners.length} signers.`;

    thresholdBox.appendChild(thresholdLabel);
    thresholdBox.appendChild(thresholdValue);
    mainContainer.appendChild(thresholdBox);

    // Append the main container to buffer
    this.buffer.appendChild(mainContainer);
  }

  private async initializeWalletConnect(chainId: number): Promise<void> {
    this.signClient = await SignClient.init({
      projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'your_wallet_connect_project_id',
      metadata: {
        name: 'Minimalist Safe{Wallet}',
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
          methods: [
            'eth_sign',
            'personal_sign',
            'eth_signTypedData',
            'eth_signTypedData_v4'
          ],
          chains: [`eip155:${chainId}`],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
    });

    if (!uri) {
      throw new Error('Failed to generate WalletConnect URI');
    }

    // Clear the buffer and ensure proper layout
    this.buffer.innerHTML = '';
    this.buffer.className = 'flex-1 p-4 overflow-y-auto';
    this.mainContent.classList.add('hidden');
    this.helpContainer.innerHTML = '';
    this.helpContainer.classList.add('hidden');
    this.helpScreen.innerHTML = '';
    this.helpScreen.classList.add('hidden');

    // Create a container for the QR code
    const qrContainer = document.createElement('div');
    qrContainer.className = 'flex flex-col items-center justify-center min-h-[400px]';
    
    const text = document.createElement('p');
    text.textContent = 'Connect your wallet by scanning the QR code below:';
    text.className = 'text-center mb-4 text-gray-300';
    
    const canvas = document.createElement('canvas');
    canvas.className = 'mx-auto mb-4';
    
    qrContainer.appendChild(text);
    qrContainer.appendChild(canvas);

    // Create an elegant pairing code container
    const uriContainer = document.createElement('div');
    uriContainer.className = 'w-full max-w-md bg-gray-800 rounded-lg border border-gray-700 overflow-hidden shadow-lg';
    
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
    
    qrContainer.appendChild(uriContainer);

    // Add the QR code container to the buffer
    this.buffer.appendChild(qrContainer);

    // Generate QR code
    await QRCode.toCanvas(canvas, uri, { width: 300 }, (error: Error | null | undefined) => {
      if (error) {
        console.error('QR Code rendering error:', error);
        this.buffer.textContent = `Error generating QR code: ${error.message}`;
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
    } catch (error: unknown) {
      console.error('WalletConnect session approval failed:', error);
      this.buffer.textContent = `Error establishing session: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-500';
      
      // Reset command state
      this.command = '';
      this.updateStatus();
      this.commandInput.value = '';
      this.commandInput.blur();
      setTimeout(() => this.commandInput.focus(), 100);
      throw error;
    }
  }

}

export default VimApp;
