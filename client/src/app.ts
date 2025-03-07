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
      displayName: 'Ethereum'
    },
    arbitrum: {
      name: 'arbitrum',
      chainId: 42161,
      provider: `https://arb-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
      displayName: 'Arbitrum'
    },
    sepolia: {
      name: 'sepolia',
      chainId: 11155111,
      provider: `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
      displayName: 'Sepolia'
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

    // Initialize event listeners first
    this.initEventListeners();

    // Then show initial screen
    this.showInitialInputContainer();
    this.showHelpGuide();
    this.updateTitle();
    
    // Initialize socket listeners
    this.initSocketListeners();
    this.updateStatus();

    // Focus command input last
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);

    // Check for Safe address in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const safeAddress = urlParams.get('safe');
    if (safeAddress && this.safeAddressInput) {
      this.safeAddressInput.value = safeAddress;
      this.safeAddressInput.readOnly = true;
      this.safeAddressInput.classList.add('opacity-50', 'cursor-pointer');
      this.commandInput.focus();
      
      // Automatically connect to the Safe wallet
      this.connectWallet(safeAddress).catch(error => {
        console.error('Failed to auto-connect to Safe:', error);
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to connect to Safe'}`;
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
      });
    }
  }

  private initEventListeners(): void {
    // Simple keydown handler for command input
    this.commandInput.addEventListener('keydown', async (e: KeyboardEvent) => {
      if (e.key === ':') {
        this.command = ':';
        this.updateStatus();
        e.preventDefault();
      } else if (this.command.startsWith(':')) {
        if (e.key === 'Enter') {
          await this.executeCommand();
          this.command = '';
        } else if (e.key === 'Backspace') {
          this.command = this.command.slice(0, -1);
        } else if (e.key === 'Escape') {
          this.command = '';
        } else if (e.key.length === 1) {
          this.command += e.key;
        }
        this.updateStatus();
        e.preventDefault();
      } else if (e.key === 'e' && !this.command) {
        await this.handleNormalMode(e);
      }
    });

    // Global click handler to maintain focus
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('input') && !target.closest('select') && !target.closest('button')) {
        this.commandInput.focus();
      }
    });
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
    newContainer.className = 'w-full sm:w-1/2 p-4';
    newContainer.innerHTML = `
      <div class="space-y-4 sm:space-y-0">
        <div class="relative flex flex-col sm:flex-row sm:items-center sm:gap-4">
          <div class="flex-grow relative">
            <div class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none">
              <div class="w-6 h-6 bg-gray-600 rounded-full"></div>
            </div>
            <input 
              type="text" 
              id="safe-address-input" 
              class="block pl-14 pr-2.5 py-4 w-full text-white bg-[#2c2c2c] rounded-lg border border-gray-700 appearance-none focus:outline-none focus:ring-0 focus:border-blue-600 peer" 
              placeholder=" "
            />
            <label 
              for="safe-address-input" 
              class="absolute text-sm text-gray-400 duration-300 transform -translate-y-6 scale-75 top-2 z-10 origin-[0] bg-[#2c2c2c] px-2 peer-focus:px-2 peer-focus:text-blue-600 left-1"
            >
              Safe Account
            </label>
          </div>
          <div class="flex-shrink-0 relative mt-4 sm:mt-0">
            <select id="network-select" class="block w-full sm:w-36 h-[58px] px-3 text-white bg-[#2c2c2c] border border-gray-700 rounded-lg focus:outline-none focus:ring-0 focus:border-blue-600 appearance-none cursor-pointer">
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
    mainContentDiv.classList.remove('hidden');

    // Re-initialize references
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
    this.networkSelect = document.getElementById('network-select') as HTMLSelectElement;

    // Check for Safe address in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const safeAddress = urlParams.get('safe');
    if (safeAddress && this.safeAddressInput) {
      this.safeAddressInput.value = safeAddress;
      this.safeAddressInput.readOnly = true;
      this.safeAddressInput.classList.add('opacity-50', 'cursor-pointer');
      this.commandInput.focus();
      
      // Automatically connect to the Safe wallet
      this.connectWallet(safeAddress).catch(error => {
        console.error('Failed to auto-connect to Safe:', error);
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to connect to Safe'}`;
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
      });
    }

    // Add event listeners for command input handling
    if (this.safeAddressInput) {
      this.safeAddressInput.addEventListener('keydown', (e) => {
        // Allow command input to capture : key for starting commands
        if (e.key === ':') {
          e.preventDefault();
          this.commandInput.focus();
          this.command = ':';
          this.updateStatus();
        }
      });

      this.safeAddressInput.addEventListener('paste', () => {
        setTimeout(() => {
          if (this.safeAddressInput) {
            this.safeAddressInput.readOnly = true;
            this.safeAddressInput.classList.add('opacity-50', 'cursor-pointer');
            this.commandInput.focus();
          }
        }, 10);
      });

      this.safeAddressInput.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.safeAddressInput && this.safeAddressInput.readOnly) {
          this.safeAddressInput.readOnly = false;
          this.safeAddressInput.classList.remove('opacity-50', 'cursor-pointer');
          this.safeAddressInput.focus();
        }
      });
    }

    if (this.networkSelect) {
      this.networkSelect.addEventListener('keydown', (e) => {
        // Allow command input to capture : key for starting commands
        if (e.key === ':') {
          e.preventDefault();
          this.commandInput.focus();
          this.command = ':';
          this.updateStatus();
        }
      });

      this.networkSelect.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      this.networkSelect.addEventListener('change', async (e) => {
        e.stopPropagation();
        const selectedNetwork = (e.target as HTMLSelectElement).value;
        
        // Clear any existing Safe info cache when network changes
        this.clearSafeInfoCache();
        
        // Update network and provider
        this.selectedNetwork = this.networks[selectedNetwork];
        this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);
        
        // If a Safe is connected, verify it exists on the new network
        if (this.safeAddress) {
          try {
            const code = await this.provider.getCode(this.safeAddress);
            if (code === '0x') {
              this.buffer.innerHTML = '';
              const warningMsg = document.createElement('p');
              warningMsg.textContent = `Warning: Safe ${this.safeAddress} does not exist on ${this.selectedNetwork.displayName}`;
              warningMsg.className = 'text-yellow-400';
              this.buffer.appendChild(warningMsg);
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

        // Focus command input after network selection
        setTimeout(() => {
          this.commandInput.focus();
        }, 100);
      });
    }

    // Add container-level event listeners
    this.inputContainer?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Update help container classes for mobile responsiveness
    const helpContainer = document.getElementById('help-container') as HTMLDivElement;
    helpContainer.className = 'w-full sm:w-1/2 p-4';
    helpContainer.classList.remove('hidden');

    // Update main content layout for mobile responsiveness
    mainContentDiv.className = 'flex flex-col sm:flex-row w-full';

    // Ensure command input is focused initially
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);
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
      this.helpContainer.className = 'flex-1 p-4';
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

      // Update the Safe address display with ENS name if available
      if (this.safeAddressDisplay) {
        const ensName = await this.resolveEnsName(safeAddress);
        this.safeAddressDisplay.textContent = ensName 
          ? `${ensName} (${this.truncateAddress(safeAddress)})` 
          : this.truncateAddress(safeAddress);
      }

      // Clear URL parameters after successful connection
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', newUrl);

      // Show and update the header network select
      const headerNetworkContainer = document.getElementById('header-network-container');
      const headerNetworkSelect = document.getElementById('header-network-select') as HTMLSelectElement;
      if (headerNetworkContainer && headerNetworkSelect) {
        headerNetworkContainer.classList.remove('hidden');
        headerNetworkSelect.innerHTML = `<option value="${this.selectedNetwork.name}">${this.selectedNetwork.displayName}</option>`;
      }

      // Load and cache Safe info for the selected network
      await this.loadAndCacheSafeInfo();

      // Only remove the input container if everything succeeded
      if (this.inputContainer) {
        this.inputContainer.remove();
        this.inputContainer = null;
        this.safeAddressInput = null;
        this.networkSelect = null;
      }
        
        // Clear the buffer and show success message
        this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = 'Successfully connected to Safe!';
      successMsg.className = 'text-green-400';
      this.buffer.appendChild(successMsg);

      // Ensure command input is focused
      setTimeout(() => {
        this.commandInput.focus();
      }, 100);

    } catch (error: unknown) {
      console.error('Failed to connect to Safe:', error);
      
      // Show error message
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      
      // Reset Safe address and cached info
      this.safeAddress = null;
      this.clearSafeInfoCache();
      
      // Make sure input container is still available
      if (!this.inputContainer) {
        this.showInitialInputContainer();
      }
      
      // Ensure command input is focused
      setTimeout(() => {
        this.commandInput.focus();
      }, 100);
      
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private setupWalletConnectListeners(): void {
    if (!this.signClient) return;
    
    // Listen for session deletion events (disconnections)
    this.signClient.on('session_delete', ({ topic }: { topic: string }) => {
      console.log(`WalletConnect session deleted: ${topic}`);
      
      // Only handle if it's our current session
      if (this.sessionTopic === topic) {
        this.handleWalletDisconnect();
      }
    });
    
    // Listen for session expiration events
    this.signClient.on('session_expire', ({ topic }: { topic: string }) => {
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
    
    // Update the UI - ensure signer address display is cleared
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
      
      // Hide the header network select
      const headerNetworkContainer = document.getElementById('header-network-container');
      if (headerNetworkContainer) {
        headerNetworkContainer.classList.add('hidden');
      }
      
      // Remove existing input container if it exists
      const existingContainer = document.getElementById('input-container');
      if (existingContainer) {
        existingContainer.remove();
      }
      
      // Show initial input container with fresh event listeners
      this.showInitialInputContainer();
      
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
    form.onsubmit = (e) => e.preventDefault();

    // Initialize txFormData
    this.txFormData = { to: '', value: '', data: '' };

    // Create form fields
    const fields = [
      {
        id: 'tx-to',
        label: 'To Address',
        type: 'combo',
        placeholder: '0x...',
        required: true
      },
      {
        id: 'tx-value',
        label: 'Value (ETH)',
        type: 'text',
        placeholder: '0.0'
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

      let input: HTMLInputElement | HTMLTextAreaElement;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = field.rows as number;
        input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
      } else if (field.type === 'combo') {
        // Create input for address entry with custom dropdown
        input = document.createElement('input');
        input.type = 'text';
        input.id = field.id;
        input.className = 'block w-full rounded-md border-0 py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-700 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 bg-gray-700';
        input.placeholder = field.placeholder;
        if (field.required) input.required = true;

        // Create custom dropdown container
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'absolute z-10 mt-1 w-full overflow-auto rounded-md bg-gray-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm hidden';
        
        // Add owner options if available
        if (this.cachedSafeInfo && this.cachedSafeInfo.owners.length > 0) {
          this.cachedSafeInfo.owners.forEach(owner => {
            const option = document.createElement('div');
            option.className = 'relative cursor-pointer select-none py-2 pl-3 pr-9 text-gray-300 hover:bg-gray-700 hover:text-white text-left';
            option.textContent = owner;
            
            option.addEventListener('click', () => {
              input.value = owner;
              this.txFormData!.to = owner;
              dropdownContainer.classList.add('hidden');
            });
            
            dropdownContainer.appendChild(option);
          });
        }

        // Add input event listener to update txFormData and show/hide dropdown
        input.addEventListener('input', () => {
          this.txFormData!.to = input.value;
          dropdownContainer.classList.remove('hidden');
        });

        // Add focus/blur handlers for dropdown
        input.addEventListener('focus', () => {
          dropdownContainer.classList.remove('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!input.contains(e.target as Node) && !dropdownContainer.contains(e.target as Node)) {
            dropdownContainer.classList.add('hidden');
          }
        });

        // Add keydown event listener for : key and navigation
        const vimApp = this; // Capture VimApp instance
        input.addEventListener('keydown', function(this: HTMLElement, e: Event) {
          const keyEvent = e as KeyboardEvent;
          if (keyEvent.key === ':') {
            e.preventDefault();
            e.stopPropagation();
            (document.getElementById('command-input') as HTMLInputElement)?.focus();
            (window as any).vimApp.command = ':';
            (window as any).vimApp.updateStatus();
          } else if (keyEvent.key === 'ArrowDown' || keyEvent.key === 'ArrowUp') {
            e.preventDefault();
            const options = dropdownContainer.children;
            const currentIndex = Array.from(options).findIndex(opt => opt.classList.contains('bg-gray-700'));
            
            if (keyEvent.key === 'ArrowDown') {
              const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
              options[currentIndex]?.classList.remove('bg-gray-700');
              options[nextIndex]?.classList.add('bg-gray-700');
            } else {
              const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
              options[currentIndex]?.classList.remove('bg-gray-700');
              options[prevIndex]?.classList.add('bg-gray-700');
            }
          } else if (keyEvent.key === 'Enter') {
            e.preventDefault();
            const selectedOption = dropdownContainer.querySelector('.bg-gray-700');
            if (selectedOption) {
              input.value = selectedOption.textContent || '';
              vimApp.txFormData!.to = input.value;
              dropdownContainer.classList.add('hidden');
            }
          } else if (keyEvent.key === 'Escape') {
            dropdownContainer.classList.add('hidden');
          }
        });

        // Create a wrapper div for better styling
        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative w-full';
        inputWrapper.appendChild(input);
        inputWrapper.appendChild(dropdownContainer);

        fieldContainer.appendChild(label);
        fieldContainer.appendChild(inputWrapper);
        form.appendChild(fieldContainer);
        return;
              } else {
        input = document.createElement('input');
        input.type = field.type;
        input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
      }

      input.id = field.id;
      input.placeholder = field.placeholder;
      if (field.required) input.required = true;

      // Add input event listener to update txFormData in real-time
      input.addEventListener('input', () => {
        if (field.id === 'tx-to') {
          this.txFormData!.to = (input as HTMLInputElement).value;
        } else if (field.id === 'tx-value') {
          this.txFormData!.value = (input as HTMLInputElement).value;
        } else if (field.id === 'tx-data') {
          this.txFormData!.data = (input as HTMLTextAreaElement).value;
        }
      });

      // Add keydown event listener for each input to handle : key
      input.addEventListener('keydown', function(this: HTMLElement, e: Event) {
        const keyEvent = e as KeyboardEvent;
        if (keyEvent.key === ':') {
          e.preventDefault();
          e.stopPropagation();
          (document.getElementById('command-input') as HTMLInputElement)?.focus();
          (window as any).vimApp.command = ':';
          (window as any).vimApp.updateStatus();
        }
      });

        fieldContainer.appendChild(label);
      if (!field.type.includes('combo')) {
        fieldContainer.appendChild(input);
      }
      form.appendChild(fieldContainer);
    });

    // Add helper text
    const helperText = document.createElement('p');
    helperText.className = 'mt-6 text-sm text-gray-400';
    helperText.textContent = 'Fill in the transaction details and use :p command to prepare and sign the transaction.';
    form.appendChild(helperText);

    // Assemble the form
    formContainer.appendChild(title);
    formContainer.appendChild(form);
    this.buffer.appendChild(formContainer);

    // Ensure command input is focused initially
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);
  }

  private async calculateSafeTxHash(
    to: string,
    value: string,
    data: string,
    operation: number,
    nonce: string,
    chainId: number,
    safeAddress: string
  ): Promise<string> {
    // Ensure data is properly formatted
    const formattedData = data ? (data.startsWith('0x') ? data : `0x${data}`) : '0x';
    
    // Ensure value is properly formatted
    const formattedValue = value ? 
      (value.startsWith('0x') ? value : ethers.parseEther(value).toString()) : 
      '0x0';

    // Prepare transaction object
    const transaction = {
      to,
      value: formattedValue,
      data: formattedData,
      operation,
      nonce,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
    };

    // Prepare EIP-712 typed data
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'verifyingContract', type: 'address' },
          { name: 'chainId', type: 'uint256' }
        ],
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
      },
      primaryType: 'SafeTx',
      domain: {
        verifyingContract: safeAddress,
        chainId
      },
      message: transaction
    };

    // Calculate the safeTxHash using ethers.js
    const safeTxHash = ethers.TypedDataEncoder.hash(
      typedData.domain,
      { SafeTx: typedData.types.SafeTx },
      typedData.message
    );

    return safeTxHash;
  }

  private async prepareAndSignTransaction() {
    if (!this.safeAddress || !this.cachedSafeInfo) {
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = 'Error: No Safe connected. Use :c to connect to a Safe first.';
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      return;
    }

    if (!this.txFormData || !this.txFormData.to) {
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = 'No transaction data found. Please create a transaction with :t first.';
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      return;
    }

    try {
      // Validate transaction data
      if (!ethers.isAddress(this.txFormData.to)) {
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'Error: Invalid destination address';
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
        return;
      }

      // Convert value to hex if it's not already
      const valueHex = this.txFormData.value ? 
        (this.txFormData.value.startsWith('0x') ? 
          this.txFormData.value : 
          `0x${ethers.parseEther(this.txFormData.value).toString(16)}`) : 
        '0x0';
      
      // Ensure data is hex
      const dataHex = this.txFormData.data ? 
        (this.txFormData.data.startsWith('0x') ? 
          this.txFormData.data : 
          `0x${this.txFormData.data}`) : 
        '0x';

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

      // Prepare transaction on backend
      const response = await fetch(`${apiUrl}/safe/prepare-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          safeAddress: this.safeAddress,
          transaction: {
            to: this.txFormData.to,
            value: valueHex,
            data: dataHex,
            operation: 0
          },
          network: this.selectedNetwork.name
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to prepare transaction');
      }

      const result = await response.json();
      console.log('Received prepared transaction:', result);

      // Clear buffer and show signing request
      this.buffer.innerHTML = '';
      const signingContainer = document.createElement('div');
      signingContainer.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg space-y-4';
      
      const signingTitle = document.createElement('h3');
      signingTitle.className = 'text-xl font-bold text-white mb-4';
      signingTitle.textContent = 'Sign Transaction';
      signingContainer.appendChild(signingTitle);

      // Add transaction details
      const detailsBox = document.createElement('div');
      detailsBox.className = 'bg-gray-700 p-4 rounded-lg';
      
      const detailsTitle = document.createElement('h4');
      detailsTitle.className = 'text-gray-300 font-medium mb-2';
      detailsTitle.textContent = 'Transaction Details';
      detailsBox.appendChild(detailsTitle);

      const detailsList = document.createElement('ul');
      detailsList.className = 'space-y-2 text-sm';
      
      // Add To address
      const toItem = document.createElement('li');
      toItem.className = 'flex justify-between items-center';
      toItem.innerHTML = `
        <span class="text-gray-400">To:</span>
        <span class="font-mono text-gray-300">${this.txFormData.to}</span>
      `;
      detailsList.appendChild(toItem);

      // Add Value with both ETH and hex format
      const valueItem = document.createElement('li');
      valueItem.className = 'flex justify-between items-start';
      valueItem.innerHTML = `
        <span class="text-gray-400">Value:</span>
        <div class="text-right">
          <div class="font-mono text-gray-300">${this.txFormData.value || '0'} ETH</div>
          <div class="font-mono text-xs text-gray-500">${valueHex}</div>
        </div>
      `;
      detailsList.appendChild(valueItem);

      // Add Data
      const dataItem = document.createElement('li');
      dataItem.className = 'flex justify-between items-center';
      dataItem.innerHTML = `
        <span class="text-gray-400">Data:</span>
        <span class="font-mono text-gray-300">${this.txFormData.data || '0x'}</span>
      `;
      detailsList.appendChild(dataItem);

      detailsBox.appendChild(detailsList);
      signingContainer.appendChild(detailsBox);

      // Add domain hash
      const domainHash = ethers.TypedDataEncoder.hashDomain({
        verifyingContract: result.typedData.domain.verifyingContract,
        chainId: result.typedData.domain.chainId
      });
      const domainHashBox = document.createElement('div');
      domainHashBox.className = 'bg-gray-700 p-4 rounded-lg';
      domainHashBox.innerHTML = `
        <h4 class="text-gray-300 font-medium mb-2">Domain Hash</h4>
        <div class="font-mono text-xs break-all bg-gray-800 p-2 rounded border border-gray-600">${domainHash}</div>
      `;
      signingContainer.appendChild(domainHashBox);

      // Add message hash
      const messageHash = ethers.TypedDataEncoder.from({
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
      }).hash(result.typedData.message);
      const messageHashBox = document.createElement('div');
      messageHashBox.className = 'bg-gray-700 p-4 rounded-lg';
      messageHashBox.innerHTML = `
        <h4 class="text-gray-300 font-medium mb-2">Message Hash</h4>
        <div class="font-mono text-xs break-all bg-gray-800 p-2 rounded border border-gray-600">${messageHash}</div>
      `;
      signingContainer.appendChild(messageHashBox);

      // Add Safe transaction hash from backend
      const hashBox = document.createElement('div');
      hashBox.className = 'bg-gray-700 p-4 rounded-lg';
      hashBox.innerHTML = `
        <h4 class="text-gray-300 font-medium mb-2">Safe Transaction Hash (Backend)</h4>
        <div class="font-mono text-xs break-all bg-gray-800 p-2 rounded border border-gray-600">${result.safeTxHash}</div>
      `;
      signingContainer.appendChild(hashBox);

      // Calculate and add locally calculated Safe transaction hash
      const calculatedHash = await this.calculateSafeTxHash(
        this.txFormData.to,
        this.txFormData.value,
        this.txFormData.data,
        0,
        result.typedData.message.nonce,
        this.selectedNetwork.chainId,
        this.safeAddress
      );
      
      const calculatedHashBox = document.createElement('div');
      calculatedHashBox.className = 'bg-gray-700 p-4 rounded-lg';
      
      // Add verification status
      const hashesMatch = calculatedHash === result.safeTxHash;
      const verificationStatus = document.createElement('div');
      verificationStatus.className = `text-sm ${hashesMatch ? 'text-green-400' : 'text-red-400'} mb-2`;
      verificationStatus.textContent = hashesMatch ? '✓ Hash verification successful' : '✗ Hash verification failed';
      
      calculatedHashBox.innerHTML = `
        <h4 class="text-gray-300 font-medium mb-2">Safe Transaction Hash (Calculated)</h4>
        <div class="font-mono text-xs break-all bg-gray-800 p-2 rounded border border-gray-600">${calculatedHash}</div>
      `;
      calculatedHashBox.insertBefore(verificationStatus, calculatedHashBox.firstChild);
      signingContainer.appendChild(calculatedHashBox);

      const signingMsg = document.createElement('p');
      signingMsg.textContent = 'Please sign the transaction in your wallet...';
      signingMsg.className = 'text-blue-400 text-lg font-medium mt-4';
      signingContainer.appendChild(signingMsg);

      this.buffer.appendChild(signingContainer);

      // Request signature using the typed data from backend
      const signature = await this.signMessage(JSON.stringify(result.typedData));
      if (!signature) {
        return;
      }

      // Send signature to backend
      const signResponse = await fetch(`${apiUrl}/safe/send-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          safeAddress: this.safeAddress,
          to: this.txFormData.to,
          value: valueHex,
          data: dataHex,
          operation: 0,
          network: this.selectedNetwork.name,
          signature
        }),
      });

      if (!signResponse.ok) {
        throw new Error('Failed to send transaction');
      }

      const signResult = await signResponse.json();
      console.log('Server response after signing:', signResult);
      
      // Show success message
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = 'Transaction signed successfully!';
      successMsg.className = 'text-green-500';
      this.buffer.appendChild(successMsg);

      // Clear form data
      this.txFormData = null;
      
      // Focus command input
      this.commandInput.focus();
    } catch (error) {
      console.error('Error preparing transaction:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to prepare transaction'}`;
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
    ownersList.className = 'divide-y divide-gray-700';
    for (const owner of info.owners) {
      const ensName = info.ensNames[owner];
      const ownerItem = document.createElement('li');
      ownerItem.className = 'py-3 flex items-start space-x-3';
      
      // Add owner status indicator
      const isCurrentSigner = this.signerAddress === owner;
      const statusIndicator = document.createElement('div');
      statusIndicator.className = `mt-1.5 h-2 w-2 rounded-full ${isCurrentSigner ? 'bg-green-500' : 'bg-gray-500'}`;
      
      const ownerContent = document.createElement('div');
      ownerContent.className = 'flex-1 min-w-0';
      
      if (ensName) {
        ownerContent.innerHTML = `
          <p class="text-sm font-medium text-blue-400 truncate">${ensName}</p>
          <p class="text-xs text-gray-400 font-mono break-all">${owner}</p>
        `;
      } else {
        ownerContent.innerHTML = `
          <p class="text-xs text-gray-400 font-mono break-all">${owner}</p>
        `;
      }
      
      ownerItem.appendChild(statusIndicator);
      ownerItem.appendChild(ownerContent);
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
      successMessage.textContent = `Connected: ${ensName ? `${ensName} (${this.truncateAddress(address)})` : this.truncateAddress(address)}`;
      successMessage.className = 'text-green-400';
      this.buffer.appendChild(successMessage);
      this.buffer.className = 'flex-1 p-4 overflow-y-auto';
      
      // Update signer address display with truncated address
      this.signerAddressDisplay.textContent = ensName 
        ? `${ensName} (${this.truncateAddress(address)})` 
        : this.truncateAddress(address);
      
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

  private async signMessage(message: string): Promise<string | null> {
    try {
      // Request signature using WalletConnect v2 with eth_signTypedData_v4
      const signature = await this.signClient.request({
        topic: this.sessionTopic!,
        chainId: `eip155:${this.selectedNetwork.chainId}`,
        request: {
          method: 'eth_signTypedData_v4',
          params: [
            this.signerAddress!.toLowerCase(),
            message
          ]
        }
      });

      return signature as string;
    } catch (error) {
      console.error('Error signing message:', error);
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to sign message'}`;
      errorMsg.className = 'text-red-500 mt-4';
      this.buffer.appendChild(errorMsg);
      return null;
    }
  }

}

export default VimApp;
