import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { ethers } from 'ethers';
import { SignClient } from '@walletconnect/sign-client';
import { SafeInfo } from './types/SafeInfo';
import { NetworkConfig } from './types/NetworkConfig';
import { calculateSafeTxHash } from './utils/safeTransactions';
import { truncateAddress } from './utils/addressUtils';
import { NETWORKS, DEFAULT_NETWORK, getNetworkConfig } from './config/networks';
import { COMMANDS } from './config/commands';
import { getContractAddress } from './config/contracts';

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
  private socket!: Socket;
  private provider!: ethers.JsonRpcProvider;
  private signClient: any; // WalletConnect SignClient instance
  private sessionTopic: string | null = null; // Store the WalletConnect session topic
  private cachedSafeInfo: SafeInfo | null = null;
  private selectedNetwork!: NetworkConfig;
  private isConnecting: boolean = false; // Add flag to track connection state
  // Add transaction form data storage
  private txFormData: {
    to: string;
    value: string;
    data: string;
  } | null = null;
  private _isProposing: boolean = false;

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

    // Check if command input exists
    if (!this.commandInput) {
      console.error('Command input element not found');
      return;
    }

    // Set default network
    this.selectedNetwork = getNetworkConfig(DEFAULT_NETWORK);
    
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

    // Make sure main content is visible
    this.mainContent.classList.remove('hidden');
    this.buffer.classList.remove('hidden');

    // Focus command input last
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);

    // Re-initialize references
    this.inputContainer = document.getElementById('input-container') as HTMLDivElement;
    this.safeAddressInput = document.getElementById('safe-address-input') as HTMLInputElement;
    this.networkSelect = document.getElementById('network-select') as HTMLSelectElement;
    
    // Add paste event handler and click-to-edit functionality for Safe address input
    if (this.safeAddressInput) {
      // Handle paste event
      this.safeAddressInput.addEventListener('paste', () => {
        setTimeout(() => {
          if (this.safeAddressInput) {
            this.safeAddressInput.disabled = false;
            this.commandInput.focus();
          }
        }, 100);
      });

      // Handle click to edit
      this.safeAddressInput.addEventListener('click', function() {
        if (this.disabled) {
          this.disabled = false;
          this.focus();
        }
      });

      // Handle focus to enable editing
      this.safeAddressInput.addEventListener('focus', function() {
        if (this.disabled) {
          this.disabled = false;
        }
      });
    }

    // Ensure default network is selected
    if (this.networkSelect) {
      this.networkSelect.value = DEFAULT_NETWORK;
      // Update the provider when network changes
      this.networkSelect.addEventListener('change', () => {
        this.selectedNetwork = getNetworkConfig(this.networkSelect!.value);
        this.provider = new ethers.JsonRpcProvider(this.selectedNetwork.provider);
      });
    }
  }

  private initEventListeners(): void {
    // Simple keydown handler for command input
    this.commandInput.addEventListener('keydown', async (e: KeyboardEvent) => {
      console.log('Keydown event:', e.key); // Add logging
      
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

    // Ensure command input is focused initially
    setTimeout(() => {
      this.commandInput.focus();
    }, 100);
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
    newContainer.className = 'w-full sm:w-2/3 p-4';
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
              class="block pl-14 pr-2.5 py-4 w-full text-white bg-[#2c2c2c] rounded-lg border border-gray-700 appearance-none focus:outline-none focus:ring-0 focus:border-blue-600 peer cursor-pointer" 
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
            <select id="network-select" class="block w-full sm:w-48 h-[58px] px-3 text-white bg-[#2c2c2c] border border-gray-700 rounded-lg focus:outline-none focus:ring-0 focus:border-blue-600 appearance-none cursor-pointer">
              ${Object.entries(NETWORKS).map(([key, network]) => 
                `<option value="${key}" ${key === DEFAULT_NETWORK ? 'selected' : ''}>${network.displayName}</option>`
              ).join('')}
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

    // Add paste event handler and click-to-edit functionality for Safe address input
    if (this.safeAddressInput) {
      // Handle paste event
      this.safeAddressInput.addEventListener('paste', () => {
        setTimeout(() => {
          if (this.safeAddressInput) {
            this.safeAddressInput.disabled = false;
            this.commandInput.focus();
          }
        }, 100);
      });

      // Handle click to edit
      this.safeAddressInput.addEventListener('click', function() {
        if (this.disabled) {
          this.disabled = false;
          this.focus();
        }
      });

      // Handle focus to enable editing
      this.safeAddressInput.addEventListener('focus', function() {
        if (this.disabled) {
          this.disabled = false;
        }
      });
    }

    // Make sure help container is visible and properly styled
    const helpContainer = document.getElementById('help-container') as HTMLDivElement;
    helpContainer.className = 'w-full sm:w-1/3 p-4';
    helpContainer.classList.remove('hidden');

    // Update main content layout for mobile responsiveness
    mainContentDiv.className = 'flex flex-col sm:flex-row w-full';

    // Ensure command input is focused
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

    COMMANDS.forEach(({ cmd, desc }) => {
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
      
      // Update help container classes
      this.helpContainer.className = 'w-full sm:w-1/2 p-4';
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
          ? `${ensName} (${truncateAddress(safeAddress)})` 
          : truncateAddress(safeAddress);
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
        ? `${ensName} (${truncateAddress(this.signerAddress)})` 
        : truncateAddress(this.signerAddress);
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

    // Focus command input
    this.commandInput.focus();

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
      
      // Reset network to default
      this.selectedNetwork = getNetworkConfig(DEFAULT_NETWORK);
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
      await this.proposeToSafeTxPool();
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
    } else if (this.command === ':pool') {
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
      await this.proposeToSafeTxPool();
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

  private async getSafeNonce(safeAddress: string): Promise<string> {
    // Safe contract ABI for nonce function
    const safeAbi = [
      "function nonce() view returns (uint256)"
    ];
    
    // Create contract instance
    const safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);
    
    try {
      // Get nonce from contract
      const nonce = await safeContract.nonce();
      return nonce.toString();
    } catch (error) {
      console.error('Error getting Safe nonce:', error);
      throw new Error('Failed to get Safe nonce');
    }
  }

  private async getSafeTxHashFromContract(
    to: string,
    value: string,
    data: string,
    operation: number,
    nonce: string,
    safeAddress: string
  ): Promise<string> {
    // Safe contract ABI for getTransactionHash function
    const safeAbi = [
      "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)"
    ];
    
    // Create contract instance
    const safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);
    
    try {
      // Get hash from contract
      const hash = await safeContract.getTransactionHash(
        to,
        value,
        data,
        operation,
        '0', // safeTxGas
        '0', // baseGas
        '0', // gasPrice
        '0x0000000000000000000000000000000000000000', // gasToken
        '0x0000000000000000000000000000000000000000', // refundReceiver
        nonce
      );
      return hash;
    } catch (error) {
      console.error('Error getting Safe transaction hash:', error);
      throw new Error('Failed to get Safe transaction hash');
    }
  }

  private async proposeToSafeTxPool(): Promise<void> {
    // Use a flag to prevent duplicate requests
    if (this._isProposing) {
      console.log('Transaction proposal already in progress');
      return;
    }

    this._isProposing = true;

    try {
      // Validate requirements
      if (!this.txFormData || !this.txFormData.to) {
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'No transaction data found. Please create a transaction with :t first.';
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
        return;
      }

      if (!this.safeAddress || !this.cachedSafeInfo) {
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'Error: No Safe connected. Use :c to connect to a Safe first.';
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
        return;
      }

      if (!this.signClient || !this.sessionTopic || !this.signerAddress) {
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'Error: No wallet connected. Use :wc to connect a wallet first.';
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
        return;
      }

      // Verify session is still valid
      try {
        const session = await this.signClient.session.get(this.sessionTopic);
        if (!session || session.expiry * 1000 <= Date.now()) {
          throw new Error('Session expired');
        }
      } catch (error) {
        this.sessionTopic = null;
        this.signerAddress = null;
        this.signerAddressDisplay.textContent = '';
        throw new Error('Invalid or expired session');
      }

      // Store tx data locally
      const localTxData = {
        to: this.txFormData.to,
        value: this.txFormData.value || '0',
        data: this.txFormData.data || '0x'
      };

      // Get contract address and prepare basic data
      const contractAddresses = getContractAddress(this.selectedNetwork);
      const nonce = await this.getSafeNonce(this.safeAddress);
      
      // Convert value to hex
      const valueHex = localTxData.value.startsWith('0x') ? 
        localTxData.value : 
        `0x${ethers.parseEther(localTxData.value).toString(16)}`;
      
      // Ensure data is hex
      const dataHex = localTxData.data.startsWith('0x') ? localTxData.data : `0x${localTxData.data}`;

      // Get hash from Safe contract
      const safeTxHash = await this.getSafeTxHashFromContract(
        localTxData.to,
        valueHex,
        dataHex,
        0,
        nonce,
        this.safeAddress
      );

      // Show preview before sending
      this.buffer.innerHTML = '';
      const previewMsg = document.createElement('div');
      previewMsg.className = 'max-w-2xl mx-auto space-y-4';

      // Transaction Details Section
      const txDetailsSection = document.createElement('div');
      txDetailsSection.className = 'bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';
      txDetailsSection.innerHTML = `
        <h3 class="text-xl font-bold text-white mb-4">Transaction Preview</h3>
        <div class="space-y-4">
          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Contract Details</h4>
            <div class="space-y-2 font-mono text-sm">
              <p class="flex justify-between">
                <span class="text-gray-500">Contract:</span>
                <span class="text-gray-300">${contractAddresses.safeTxPool}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-gray-500">Function:</span>
                <span class="text-gray-300">proposeTx</span>
              </p>
            </div>
          </div>

          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Transaction Parameters</h4>
            <div class="space-y-2 font-mono text-sm">
              <p class="flex justify-between">
                <span class="text-gray-500">Safe:</span>
                <span class="text-gray-300">${this.safeAddress}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-gray-500">Target:</span>
                <span class="text-gray-300">${localTxData.to}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-gray-500">Value:</span>
                <span class="text-gray-300">${ethers.formatEther(valueHex)} ETH</span>
              </p>
              <p class="flex justify-between">
                <span class="text-gray-500">Operation:</span>
                <span class="text-gray-300">0 (Call)</span>
              </p>
              <p class="flex justify-between">
                <span class="text-gray-500">Nonce:</span>
                <span class="text-gray-300">${nonce}</span>
              </p>
            </div>
          </div>

          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Transaction Data</h4>
            <div class="font-mono text-sm break-all text-gray-300">
              ${dataHex}
            </div>
          </div>
        </div>
      `;

      // Hash Verification Section
      const hashSection = document.createElement('div');
      hashSection.className = 'bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';
      
      // Calculate our hash for comparison
      const calculatedHash = await calculateSafeTxHash(
        {
          to: localTxData.to,
          value: valueHex,
          data: dataHex,
          operation: 0,
          nonce
        },
        this.safeAddress,
        this.selectedNetwork.chainId
      );

      const hashVerification = safeTxHash === calculatedHash;
      
      hashSection.innerHTML = `
        <h3 class="text-xl font-bold text-white mb-4">Hash Verification</h3>
        <div class="space-y-4">
          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Safe Contract Hash</h4>
            <div class="font-mono text-sm break-all text-gray-300">
              ${safeTxHash}
            </div>
          </div>

          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Calculated Hash</h4>
            <div class="font-mono text-sm break-all text-gray-300">
              ${calculatedHash}
            </div>
          </div>

          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Hash Verification</h4>
            <div class="flex items-center gap-2">
              <span class="${hashVerification ? 'text-green-400' : 'text-red-400'} font-medium">
                ${hashVerification ? '✓ Verified' : '✗ Invalid'}
              </span>
              <span class="text-gray-400 text-sm">
                ${hashVerification ? 
                  'Safe transaction hash matches the calculated hash' : 
                  'Warning: Safe transaction hash does not match the calculated hash'}
              </span>
            </div>
          </div>
        </div>
      `;

      previewMsg.appendChild(txDetailsSection);
      previewMsg.appendChild(hashSection);
      this.buffer.appendChild(previewMsg);

      // If hash verification fails, show warning and return
      if (!hashVerification) {
        const warningMsg = document.createElement('div');
        warningMsg.className = 'max-w-2xl mx-auto mt-4 bg-red-900/50 p-4 rounded-lg text-red-200';
        warningMsg.innerHTML = `
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <span class="font-medium">Transaction cannot proceed due to hash mismatch</span>
          </div>
          <p class="mt-2 text-sm">Please verify the transaction parameters and try again.</p>
        `;
        this.buffer.appendChild(warningMsg);
        return;
      }

      // Encode function data for the transaction
      const iface = new ethers.Interface([
        "function proposeTx(bytes32 safeTxHash, address safe, address to, uint256 value, bytes data, uint8 operation, uint256 nonce) external returns (bool)"
      ]);

      const encodedTxData = iface.encodeFunctionData("proposeTx", [
        safeTxHash,
        this.safeAddress,
        localTxData.to,
        BigInt(valueHex),
        dataHex,
        0,
        BigInt(nonce)
      ]);

      // Create a unique request ID
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Prepare the transaction request with unique ID
      const request = {
        topic: this.sessionTopic,
        chainId: `eip155:${this.selectedNetwork.chainId}`,
        request: {
          id: requestId,
          jsonrpc: '2.0',
          method: 'eth_sendTransaction',
          params: [{
            from: this.signerAddress,
            to: contractAddresses.safeTxPool,
            data: encodedTxData,
            value: "0x0"
          }]
        }
      };

      // Send the transaction with proper error handling
      let txHash;
      try {
        // Send the request and wait for response
        txHash = await this.signClient.request(request);
        
        if (!txHash || typeof txHash !== 'string') {
          throw new Error('Invalid transaction hash received');
        }
      } catch (error) {
        console.error('Transaction request failed:', error);
        throw error;
      }

      // Show success message
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('div');
      successMsg.className = 'bg-green-900 p-4 rounded-lg text-white';
      successMsg.innerHTML = `
        <h3 class="text-xl font-bold mb-2">Transaction Proposed Successfully</h3>
        <div class="space-y-2">
          <div class="font-mono text-sm bg-gray-800 p-2 rounded">
            <p class="font-bold text-blue-400">Transaction Hash:</p>
            <p class="break-all">${txHash}</p>
          </div>
        </div>
        <p class="mt-4">The transaction has been proposed to the SafeTxPool contract. Other owners can now sign it.</p>
      `;
      this.buffer.appendChild(successMsg);

      // Clear form data only after successful transaction
      this.txFormData = null;

    } catch (error: unknown) {
      console.error('Failed to propose transaction to SafeTxPool:', error);
      
      // Handle session errors
      if (error instanceof Error && 
          (error.message.includes('session topic') || 
           error.message.includes('No matching key') ||
           error.message.includes('expired'))) {
        this.sessionTopic = null;
        this.signerAddress = null;
        this.signerAddressDisplay.textContent = '';
        
        this.buffer.innerHTML = '';
        const reconnectMsg = document.createElement('p');
        reconnectMsg.textContent = 'WalletConnect session expired. Please reconnect using :wc command.';
        reconnectMsg.className = 'text-yellow-400';
        this.buffer.appendChild(reconnectMsg);
        return;
      }
      
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
    } finally {
      this._isProposing = false;
    }
  }

  private clearSafeInfoCache(): void {
    this.cachedSafeInfo = null;
  }

  private async loadAndCacheSafeInfo(): Promise<void> {
    if (!this.safeAddress) return;

    try {
      // Get Safe info from the contract
      const safeContract = new ethers.Contract(
        this.safeAddress,
        [
          "function getOwners() view returns (address[])",
          "function getThreshold() view returns (uint256)",
          "function getBalance() view returns (uint256)"
        ],
        this.provider
      );

      const [owners, threshold, balance] = await Promise.all([
        safeContract.getOwners(),
        safeContract.getThreshold(),
        this.provider.getBalance(this.safeAddress)
      ]);

      // Resolve ENS names for owners
            const ensNames: { [address: string]: string | null } = {};
      for (const owner of owners) {
              ensNames[owner] = await this.resolveEnsName(owner);
            }

            this.cachedSafeInfo = {
        owners,
        threshold: Number(threshold),
        balance: balance.toString(),
              ensNames,
              network: this.selectedNetwork.name,
              chainId: this.selectedNetwork.chainId
            };
          } catch (error) {
      console.error('Error loading Safe info:', error);
      throw error;
    }
  }

  private displaySafeInfo(safeInfo: SafeInfo): void {
    this.buffer.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg space-y-4';

    // Create title
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-4';
    title.textContent = 'Safe Information';
    container.appendChild(title);

    // Create info box
    const infoBox = document.createElement('div');
    infoBox.className = 'bg-gray-700 p-4 rounded-lg';
    
    const infoList = document.createElement('ul');
    infoList.className = 'space-y-2 text-sm';

    // Add Safe details
    const details = [
      { label: 'Safe Address', value: this.safeAddress || '' },
      { label: 'Network', value: safeInfo.network },
      { label: 'Balance', value: `${ethers.formatEther(safeInfo.balance)} ETH` },
      { label: 'Threshold', value: `${safeInfo.threshold} out of ${safeInfo.owners.length} owner(s)` }
    ];

    details.forEach(({ label, value }) => {
      const item = document.createElement('li');
      item.className = 'flex justify-between items-start';
      item.innerHTML = `
        <span class="text-gray-400">${label}:</span>
        <span class="text-gray-300 text-right">${value}</span>
      `;
      infoList.appendChild(item);
    });

    // Add owners section
    const ownersTitle = document.createElement('li');
    ownersTitle.className = 'text-gray-400 mt-4 mb-2';
    ownersTitle.textContent = 'Owners:';
    infoList.appendChild(ownersTitle);

    safeInfo.owners.forEach((owner) => {
      const ownerItem = document.createElement('li');
      ownerItem.className = 'flex items-center space-x-2 pl-4';
      const ensName = safeInfo.ensNames[owner];
        ownerItem.innerHTML = `
        <span class="text-gray-300 font-mono">
          ${ensName ? `${ensName} (${truncateAddress(owner)})` : truncateAddress(owner)}
        </span>
      `;
      infoList.appendChild(ownerItem);
    });

    infoBox.appendChild(infoList);
    container.appendChild(infoBox);
    this.buffer.appendChild(container);
  }

  private updateTitle(): void {
    document.title = this.safeAddress ? 
      `Safe ${truncateAddress(this.safeAddress)} - Minimalist Safe{Wallet}` : 
      'Minimalist Safe{Wallet}';
  }

  private async initializeWalletConnect(chainId: number): Promise<void> {
    try {
      // If there's an active session, verify it's still valid
      if (this.sessionTopic && this.signClient) {
        try {
          const session = await this.signClient.session.get(this.sessionTopic);
          if (session && session.expiry * 1000 > Date.now()) {
            // Session is still valid
            this.buffer.innerHTML = '';
            const msg = document.createElement('p');
            msg.textContent = 'Already connected to wallet!';
            msg.className = 'text-green-400';
            this.buffer.appendChild(msg);
            return;
          }
        } catch (e) {
          // Session not found or expired, clear it
          this.sessionTopic = null;
          this.signerAddress = null;
          this.signerAddressDisplay.textContent = '';
        }
      }

      // Initialize WalletConnect SignClient if not already initialized
      if (!this.signClient) {
    this.signClient = await SignClient.init({
          projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID,
      metadata: {
        name: 'Minimalist Safe{Wallet}',
            description: 'A minimalist interface for Safe{Wallet}',
            url: window.location.origin,
            icons: ['https://walletconnect.com/walletconnect-logo.svg']
          }
        });

        // Set up event listeners
    this.setupWalletConnectListeners();
      }

      // Create connection
      const connectResult = await this.signClient.connect({
      requiredNamespaces: {
        eip155: {
          methods: [
            'eth_sign',
            'personal_sign',
            'eth_signTypedData',
              'eth_signTypedData_v4',
              'eth_sendTransaction'
          ],
          chains: [`eip155:${chainId}`],
            events: ['accountsChanged', 'chainChanged']
          }
        }
      });

      // Show QR code
    this.buffer.innerHTML = '';
    const qrContainer = document.createElement('div');
      qrContainer.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';
      
      // Create title section
      const titleSection = document.createElement('div');
      titleSection.className = 'text-center mb-6';
      
      const title = document.createElement('h3');
      title.className = 'text-xl font-bold text-white mb-2';
      title.textContent = 'Connect Your Wallet';
      
      const subtitle = document.createElement('p');
      subtitle.className = 'text-gray-400 text-sm';
      subtitle.textContent = 'Scan the QR code with your WalletConnect-enabled wallet';
      
      titleSection.appendChild(title);
      titleSection.appendChild(subtitle);
      qrContainer.appendChild(titleSection);
      
      // Create QR code section
      const qrSection = document.createElement('div');
      qrSection.className = 'flex flex-col items-center justify-center bg-gray-900 p-8 rounded-lg mb-6';
      
      const qrCanvas = document.createElement('canvas');
      qrCanvas.className = 'bg-white p-4 rounded-lg shadow-lg';
      qrSection.appendChild(qrCanvas);
      qrContainer.appendChild(qrSection);

      // Add copy link section
      const copySection = document.createElement('div');
      copySection.className = 'bg-gray-900 p-4 rounded-lg';
      
      const copyLabel = document.createElement('p');
      copyLabel.className = 'text-sm font-medium text-gray-400 mb-3';
      copyLabel.textContent = 'Or copy connection link';
      copySection.appendChild(copyLabel);
      
      const copyContainer = document.createElement('div');
      copyContainer.className = 'flex items-center gap-2';
      
      const copyInput = document.createElement('input');
      copyInput.type = 'text';
      copyInput.value = connectResult.uri;
      copyInput.readOnly = true;
      copyInput.className = 'flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-mono border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';
      
      const copyButton = document.createElement('button');
      copyButton.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500';
      copyButton.textContent = 'Copy';
      
      // Add copy functionality
      copyButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(connectResult.uri);
          copyButton.textContent = 'Copied!';
          copyButton.className = 'bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-green-500';
          setTimeout(() => {
            copyButton.textContent = 'Copy';
            copyButton.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      };
      
      copyContainer.appendChild(copyInput);
      copyContainer.appendChild(copyButton);
      copySection.appendChild(copyContainer);
      qrContainer.appendChild(copySection);
      
    this.buffer.appendChild(qrContainer);

    // Generate QR code
      await QRCode.toCanvas(qrCanvas, connectResult.uri, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });

      // Wait for approval
      const session = await connectResult.approval();
      this.sessionTopic = session.topic;

      // Get the connected address
      const account = session.namespaces.eip155.accounts[0].split(':')[2];
      this.signerAddress = account;

      // Update the signer display
      await this.updateSignerDisplay();

      // Clear QR code and show success message
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('p');
      successMsg.textContent = 'Wallet connected successfully!';
      successMsg.className = 'text-green-400';
      this.buffer.appendChild(successMsg);

    } catch (error: unknown) {
      // Clear session state on error
      this.sessionTopic = null;
      this.signerAddress = null;
      this.signerAddressDisplay.textContent = '';
      
      console.error('WalletConnect initialization failed:', error);
      this.buffer.innerHTML = '';
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMsg.className = 'text-red-500';
      this.buffer.appendChild(errorMsg);
      throw error;
    }
  }
}

export default VimApp;
