import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { ethers } from 'ethers';
import { SignClient } from '@walletconnect/sign-client';
import { SafeInfo, NetworkConfig, Token } from './types';
import { truncateAddress, resolveEnsName, prepareTransactionRequest, calculateSafeTxHash, formatSafeSignatures, getSafeNonce, getSafeTxHashFromContract } from './utils';
import { NETWORKS, DEFAULT_NETWORK, getNetworkConfig, COMMANDS, getContractAddress, getExplorerUrl } from './config';
import { SafeTxPool } from './managers/transactions';
import { PriceOracle } from './services/oracle';

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
  private selectedTxHash: string | null = null; // Add this property to store selected transaction hash

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
    // Prevent duplicate connection attempts
    if (this.isConnecting) {
      console.log('Safe connection already in progress, ignoring duplicate request');
      return;
    }
    
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
      const ensName = await resolveEnsName(safeAddress, this.provider);
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
      const ensName = await resolveEnsName(this.signerAddress, this.provider);
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
          ensNames[owner] = await resolveEnsName(owner, this.provider);
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

    if (this.command === ':del') {
      if (!this.selectedTxHash) {
        this.buffer.textContent = 'Please select a transaction to delete';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect a wallet first using :wc';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      if (!this.signClient || !this.sessionTopic) {
        this.buffer.textContent = 'WalletConnect session not found. Please reconnect using :wc';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      try {
        const contractAddresses = getContractAddress(this.selectedNetwork);
        
        // Create interface for the deleteTx function
        const iface = new ethers.Interface([
          "function deleteTx(bytes32 txHash) external"
        ]);
        
        // Encode the function call data
        const encodedTxData = iface.encodeFunctionData("deleteTx", [this.selectedTxHash]);
        
        // Prepare the transaction request
        const request = await prepareTransactionRequest({
          provider: this.provider,
          signerAddress: this.signerAddress,
          sessionTopic: this.sessionTopic,
          selectedNetwork: this.selectedNetwork,
          contractAddress: contractAddresses.safeTxPool,
          encodedTxData,
          requestId: Math.floor(Math.random() * 1000000)
        });

        // Update UI to show progress
        this.buffer.textContent = 'Preparing to delete transaction...';
        
        // Add transaction summary to the UI before sending
        const txSummary = document.createElement('div');
        txSummary.className = 'max-w-2xl mx-auto mt-4 bg-red-900/50 p-6 rounded-lg border border-red-700 shadow-lg';
        txSummary.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            <h3 class="text-xl font-semibold text-red-200">Delete Transaction</h3>
          </div>
          <div class="space-y-2 text-sm">
            <p class="flex justify-between">
              <span class="text-red-400">Transaction Hash:</span>
              <span class="text-red-200">${truncateAddress(this.selectedTxHash)}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-red-400">Action:</span>
              <span class="text-red-200">Delete Transaction</span>
            </p>
            <p class="text-yellow-300 mt-2">Please confirm this action in your wallet. This cannot be undone.</p>
          </div>
        `;
        this.buffer.appendChild(txSummary);

        // Send the transaction with proper error handling
        let txHash;
        try {
          // Send the request and wait for response
          txHash = await this.signClient.request(request);
          
          if (!txHash || typeof txHash !== 'string') {
            throw new Error('Invalid transaction hash received');
          }
          
          // Show pending transaction message
          const pendingMsg = document.createElement('div');
          pendingMsg.className = 'text-blue-300 mt-4';
          pendingMsg.textContent = `Transaction submitted! Waiting for confirmation...`;
          this.buffer.appendChild(pendingMsg);
          
          // Wait for transaction to be mined
          await this.provider.waitForTransaction(txHash);
          
          // Clear selection and refresh the transaction list
          this.selectedTxHash = null;
          
          // Show success message
          const successMsg = document.createElement('div');
          successMsg.className = 'text-green-400 mt-4 p-4 bg-green-900/30 rounded-lg border border-green-800';
          successMsg.innerHTML = `
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span class="font-medium">Transaction deleted successfully!</span>
            </div>
            <p class="mt-2 text-sm">Transaction hash: ${truncateAddress(txHash)}</p>
          `;
          this.buffer.appendChild(successMsg);
          
          // Add a button to refresh the transaction list
          const refreshButton = document.createElement('button');
          refreshButton.className = 'mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors';
          refreshButton.textContent = 'Refresh Transaction List';
          refreshButton.onclick = async () => {
            this.command = ':l';
            await this.executeCommand();
          };
          this.buffer.appendChild(refreshButton);
          
        } catch (error: any) {
          console.error('Transaction request failed:', error);
          
          // Show error message
          const errorMsg = document.createElement('div');
          errorMsg.className = 'text-red-400 mt-4 p-4 bg-red-900/30 rounded-lg border border-red-800';
          
          if (error.code === 4001) {
            // User rejected the transaction
            errorMsg.innerHTML = `
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <span class="font-medium">Transaction cancelled</span>
              </div>
              <p class="mt-2 text-sm">You rejected the transaction.</p>
            `;
          } else if (error.message?.includes('NotProposer')) {
            errorMsg.innerHTML = `
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <span class="font-medium">Permission Error</span>
              </div>
              <p class="mt-2 text-sm">Only the proposer can delete this transaction.</p>
            `;
          } else {
            errorMsg.innerHTML = `
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <span class="font-medium">Transaction Failed</span>
              </div>
              <p class="mt-2 text-sm">Error: ${error.message || 'Unknown error'}</p>
            `;
          }
          
          this.buffer.appendChild(errorMsg);
        }
      } catch (error: any) {
        console.error('Failed to delete transaction:', error);
        this.buffer.textContent = `Failed to delete transaction: ${error.message || 'Unknown error'}`;
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-red-400';
      }
      return;
    }
    
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

      // Remove redundant isConnecting flag since it's handled in connectWallet
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
    } else if (this.command === ':l') {
      if (!this.safeAddress) {
        this.buffer.textContent = 'Please connect a Safe address with :c first';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      try {
        // Get contract address for the current network
        const contractAddresses = getContractAddress(this.selectedNetwork);
        const safeTxPool = new SafeTxPool(contractAddresses.safeTxPool, this.selectedNetwork);
        
        // Get pending transactions
        const pendingTxHashes = await safeTxPool.getPendingTransactions(this.safeAddress);
        
        if (pendingTxHashes.length === 0) {
          this.buffer.innerHTML = `
            <div class="max-w-4xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
              <p class="text-gray-400">No pending transactions found</p>
            </div>
          `;
          return;
        }

        // Create container for transactions table
        const container = document.createElement('div');
        container.className = 'max-w-4xl mx-auto';
        container.setAttribute('tabindex', '0'); // Make container focusable
        
        // Create table
        const table = document.createElement('div');
        table.className = 'min-w-full bg-gray-800 rounded-lg border border-gray-700 shadow-lg overflow-hidden';
        table.id = 'tx-table';

        // Table header
        const header = document.createElement('div');
        header.className = 'bg-gray-900 px-4 py-3 border-b border-gray-700';
        header.innerHTML = `
          <div class="grid grid-cols-12 gap-4 text-xs font-medium text-gray-400">
            <div class="col-span-3">Hash</div>
            <div class="col-span-3">To</div>
            <div class="col-span-2">Value</div>
            <div class="col-span-1">Nonce</div>
            <div class="col-span-2">Proposer</div>
            <div class="col-span-1">Sigs</div>
          </div>
        `;
        table.appendChild(header);

        // Store transaction details for later use
        const txDetailsMap = new Map();
        let currentFocusIndex = 0;
        const self = this; // Store reference to VimApp instance

        // Fetch and display details for each transaction
        for (const [index, txHash] of pendingTxHashes.entries()) {
          const txDetails = await safeTxPool.getTransactionDetails(txHash);
          txDetailsMap.set(txHash, txDetails);
          const valueInEth = ethers.formatEther(txDetails.value);
          
          const row = document.createElement('div');
          row.className = 'px-4 py-3 border-b border-gray-700 hover:bg-gray-700/50 cursor-pointer';
          row.setAttribute('data-tx-hash', txHash);
          row.setAttribute('data-index', index.toString());
          row.innerHTML = `
            <div class="grid grid-cols-12 gap-4 text-xs">
              <div class="col-span-3 font-mono text-blue-400">${truncateAddress(txHash)}</div>
              <div class="col-span-3 font-mono text-gray-300">${truncateAddress(txDetails.to)}</div>
              <div class="col-span-2 text-gray-300">${Number(valueInEth) > 0 ? `${valueInEth} ETH` : '-'}</div>
              <div class="col-span-1 text-gray-300">${txDetails.nonce}</div>
              <div class="col-span-2 font-mono text-gray-300">${truncateAddress(txDetails.proposer)}</div>
              <div class="col-span-1 text-gray-300">${txDetails.signatures.length}</div>
            </div>
          `;
          
          // Add click handler for selection
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            const clickedIndex = parseInt(row.getAttribute('data-index') || '0');
            currentFocusIndex = clickedIndex;
            // Remove selection from all rows
            document.querySelectorAll('#tx-table > div:not(:first-child)').forEach(r => {
              r.classList.remove('bg-gray-700', 'selected-tx');
            });
            // Add selection to clicked row
            row.classList.add('bg-gray-700', 'selected-tx');
            // Store the selected transaction hash
            self.selectedTxHash = row.getAttribute('data-tx-hash') || null;
            
            // Show transaction details
            const txHash = row.getAttribute('data-tx-hash');
            if (txHash) {
              showTxDetails(txHash);
            }
            
            // Focus the command input for immediate command entry
            if (self.commandInput) {
              self.commandInput.focus();
            }
          });

          table.appendChild(row);
        }

        container.appendChild(table);
        
        // Add help text
        const helpText = document.createElement('p');
        helpText.className = 'text-center text-gray-400 text-xs mt-4';
        helpText.textContent = 'Use ↑/↓ keys to navigate, Enter to view details, : to enter command mode, Esc to collapse details';
        container.appendChild(helpText);

        // Clear and update buffer
        this.buffer.innerHTML = '';
        this.buffer.appendChild(container);

        // Function to update focus and selection
        const updateFocus = (index: number) => {
          const rows = document.querySelectorAll('#tx-table > div:not(:first-child)');
          rows.forEach((row, i) => {
            if (i === index) {
              // Apply basic focus styling but not the distinctive selection styling
              row.classList.add('bg-gray-700');
              row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              // Store the selected transaction hash
              self.selectedTxHash = row.getAttribute('data-tx-hash') || null;
            } else {
              // Remove all styling from non-focused rows
              row.classList.remove('bg-gray-700', 'selected-tx', 'border-l-4', 'border-l-yellow-500');
              
              // Reset any modified padding
              const content = row.querySelector('.grid');
              if (content) {
                content.classList.remove('ml-2');
              }
            }
          });
          currentFocusIndex = index;
        };

        // Add keyboard navigation
        container.addEventListener('keydown', (e: KeyboardEvent) => {
          const totalTx = pendingTxHashes.length;
          
          switch (e.key) {
            case 'ArrowUp':
              e.preventDefault();
              if (currentFocusIndex > 0) {
                updateFocus(currentFocusIndex - 1);
              }
              break;
              
            case 'ArrowDown':
              e.preventDefault();
              if (currentFocusIndex < totalTx - 1) {
                updateFocus(currentFocusIndex + 1);
              }
              break;
              
            case 'Enter':
              e.preventDefault();
              const selectedTxHash = pendingTxHashes[currentFocusIndex];
              if (selectedTxHash) {
                // Keep the selection when showing details
                const selectedRow = document.querySelector(`[data-tx-hash="${selectedTxHash}"]`);
                if (selectedRow) {
                  // Ensure the row stays selected
                  document.querySelectorAll('#tx-table > div:not(:first-child)').forEach(row => {
                    row.classList.remove('bg-gray-700', 'selected-tx');
                  });
                  selectedRow.classList.add('bg-gray-700', 'selected-tx');
                }
                
                // Toggle transaction details (don't move focus)
                showTxDetails(selectedTxHash);
              }
              break;
              
            case ':':
              e.preventDefault();
              // Focus the command input when colon is pressed
              if (self.commandInput) {
                self.commandInput.focus();
                // Prepopulate with colon
                self.commandInput.value = ':';
                // Set cursor position after the colon
                self.commandInput.setSelectionRange(1, 1);
              }
              break;
              
            case 'Escape':
              e.preventDefault();
              const existingDetails = document.querySelector('.tx-details');
              if (existingDetails) {
                existingDetails.remove();
              }
              break;
            case ' ': // Space key
              e.preventDefault();
              const txHashToSelect = pendingTxHashes[currentFocusIndex];
              if (txHashToSelect) {
                // Select the transaction
                const selectedRow = document.querySelector(`[data-tx-hash="${txHashToSelect}"]`);
                if (selectedRow) {
                  // Ensure the row stays selected with more prominent styling
                  document.querySelectorAll('#tx-table > div:not(:first-child)').forEach(row => {
                    row.classList.remove('bg-gray-700', 'selected-tx', 'border-l-4', 'border-l-yellow-500', 'pl-3');
                    
                    // Reset any modified padding from previous selections
                    const content = row.querySelector('.grid');
                    if (content) {
                      content.classList.remove('ml-2');
                    }
                  });
                  
                  // Add more distinctive styling to the selected row
                  selectedRow.classList.add('bg-gray-700', 'selected-tx', 'border-l-4', 'border-l-yellow-500');
                  
                  // Adjust padding for the content to account for the border
                  const content = selectedRow.querySelector('.grid');
                  if (content) {
                    content.classList.add('ml-2');
                  }
                }
                
                // Store the selected transaction hash
                self.selectedTxHash = txHashToSelect;
                
                // Focus the command input for immediate command entry
                if (self.commandInput) {
                  self.commandInput.focus();
                }
              }
              break;
          }
        });

        // Set initial focus and selection
        setTimeout(() => {
          container.focus();
          updateFocus(0);
        }, 0);

        // Add Escape key handler for command input to return focus to the transaction table
        self.commandInput.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            // Clear any input
            self.commandInput.value = '';
            // Return focus to the container
            container.focus();
            
            // If there's a selected transaction, maintain its focus and enhance its styling
            if (self.selectedTxHash) {
              const index = pendingTxHashes.findIndex(hash => hash === self.selectedTxHash);
              if (index >= 0) {
                // Apply the distinctive selection styling
                const selectedRow = document.querySelector(`[data-tx-hash="${self.selectedTxHash}"]`);
                if (selectedRow) {
                  // Clear previous styling from all rows
                  document.querySelectorAll('#tx-table > div:not(:first-child)').forEach(row => {
                    row.classList.remove('bg-gray-700', 'selected-tx', 'border-l-4', 'border-l-yellow-500', 'pl-3');
                    
                    // Reset any modified padding from previous selections
                    const content = row.querySelector('.grid');
                    if (content) {
                      content.classList.remove('ml-2');
                    }
                  });
                  
                  // Add distinctive styling to the selected row
                  selectedRow.classList.add('bg-gray-700', 'selected-tx', 'border-l-4', 'border-l-yellow-500');
                  
                  // Adjust padding for the content to account for the border
                  const content = selectedRow.querySelector('.grid');
                  if (content) {
                    content.classList.add('ml-2');
                  }
                }
                
                updateFocus(index);
              }
            }
          }
        });

        // Function to show transaction details
        const showTxDetails = (txHash: string) => {
          // Check if details for this transaction are already open
          const existingDetails = document.querySelector('.tx-details');
          const clickedRow = document.querySelector(`[data-tx-hash="${txHash}"]`);
          
          // If details exist and belong to the clicked row, close them (toggle off)
          if (existingDetails && clickedRow && existingDetails.previousElementSibling === clickedRow) {
            existingDetails.remove();
            return;
          }
          
          // Remove any existing details row
          if (existingDetails) {
            existingDetails.remove();
          }

          const txDetails = txDetailsMap.get(txHash);
          const row = document.querySelector(`[data-tx-hash="${txHash}"]`);
          
          if (row && txDetails) {
            // Ensure the row stays selected when showing details
            document.querySelectorAll('#tx-table > div:not(:first-child)').forEach(r => {
              r.classList.remove('bg-gray-700', 'selected-tx');
            });
            row.classList.add('bg-gray-700', 'selected-tx');
            
            const detailsRow = document.createElement('div');
            detailsRow.className = 'px-4 py-3 bg-gray-900/50 tx-details';
            detailsRow.innerHTML = `
              <div class="space-y-2 text-xs">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <span class="text-gray-400">Full Hash:</span>
                    <span class="text-gray-300 font-mono break-all">${txHash}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Full To:</span>
                    <span class="text-gray-300 font-mono break-all">${txDetails.to}</span>
                  </div>
                </div>
                ${txDetails.data !== '0x' ? `
                  <div>
                    <span class="text-gray-400">Data:</span>
                    <span class="text-gray-300 font-mono break-all">${txDetails.data}</span>
                  </div>
                ` : ''}
                <div>
                  <span class="text-gray-400">Signatures:</span>
                  <div class="pl-4 space-y-1">
                    ${txDetails.signatures.map((sig: string) => 
                      `<span class="text-gray-300 font-mono break-all">${sig}</span>`
                    ).join('<br>')}
                  </div>
                </div>
              </div>
            `;
            
            row.parentNode?.insertBefore(detailsRow, row.nextElementSibling);
          }
        };

      } catch (error) {
        console.error('Failed to fetch pending transactions:', error);
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errorMsg.className = 'text-red-500';
        this.buffer.appendChild(errorMsg);
      }
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
      // Check if we're already connecting to prevent duplicate requests
      if (this.isConnecting) {
        console.log('Connection already in progress, ignoring :s command');
        return;
      }
      
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

      // Use the stored transaction hash instead of looking for selected element
      if (!this.selectedTxHash) {
        this.buffer.textContent = 'Please select a transaction to sign using ↑/↓ keys';
      this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
      return;
      }

      try {
        // Set connecting flag to prevent duplicate requests
        this.isConnecting = true;
        
        // Get contract address for the current network
        const contractAddresses = getContractAddress(this.selectedNetwork);
        
        // First convert the hash to proper hex if it isn't already
        const hashHex = this.selectedTxHash.startsWith('0x') ? this.selectedTxHash : `0x${this.selectedTxHash}`;
        
        // Then ensure it's padded to 32 bytes
        const formattedHash = ethers.zeroPadValue(hashHex, 32);

        // Get transaction details from the selected transaction
        const safeTxPool = new SafeTxPool(contractAddresses.safeTxPool, this.selectedNetwork);
        const txDetails = await safeTxPool.getTransactionDetails(this.selectedTxHash);

        // Check if user has already signed this transaction
        if (this.signerAddress) {
          const hasAlreadySigned = await safeTxPool.hasSignedTransaction(this.selectedTxHash, this.signerAddress);
          if (hasAlreadySigned) {
            this.buffer.innerHTML = '';
            const alreadySignedMsg = document.createElement('div');
            alreadySignedMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
            alreadySignedMsg.innerHTML = `
              <div class="flex items-center gap-3 mb-4">
                <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                <h3 class="text-lg font-semibold text-yellow-100">Already Signed</h3>
              </div>
              <p class="text-yellow-100 mb-4">You have already signed this transaction.</p>
              <div class="bg-yellow-900/50 p-4 rounded-lg text-sm">
                <p class="text-yellow-200 mb-2">What you can do next:</p>
                <ol class="list-decimal list-inside text-yellow-100 space-y-1">
                  <li>Wait for other owners to sign the transaction</li>
                  <li>Execute the transaction if threshold is reached using :e command</li>
                  <li>View other pending transactions with :l command</li>
                </ol>
              </div>
            `;
            this.buffer.appendChild(alreadySignedMsg);
            return;
          }
        }

        // Prepare transaction data for signing
        const localTxData = {
          to: txDetails.to,
          value: txDetails.value,
          data: txDetails.data
        };

        // Convert value to hex if needed
        const valueHex = localTxData.value.startsWith('0x') ? localTxData.value : `0x${BigInt(localTxData.value).toString(16)}`;
        
        // Ensure data is hex
        const dataHex = localTxData.data.startsWith('0x') ? localTxData.data : `0x${localTxData.data}`;

        // Use nonce from transaction details
        const nonce = txDetails.nonce;

        // Step 1: Request signature from user
        const signRequest = {
          topic: this.sessionTopic,
          chainId: `eip155:${this.selectedNetwork.chainId}`,
          request: {
            id: Math.floor(Math.random() * 1000000),
            jsonrpc: '2.0',
            method: 'eth_signTypedData_v4',
            params: [
              this.signerAddress,
              JSON.stringify({
                domain: {
                  chainId: this.selectedNetwork.chainId,
                  verifyingContract: this.safeAddress
                },
                primaryType: 'SafeTx',
                types: {
                  EIP712Domain: [
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' }
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
                message: {
                  to: localTxData.to,
                  value: valueHex,
                  data: dataHex,
                  operation: '0',
                  safeTxGas: '0',
                  baseGas: '0',
                  gasPrice: '0',
                  gasToken: '0x0000000000000000000000000000000000000000',
                  refundReceiver: '0x0000000000000000000000000000000000000000',
                  nonce
                }
              })
            ]
          }
        };

        // Show signing confirmation UI for the first step
        this.buffer.innerHTML = '';
        const confirmationMsg = document.createElement('div');
        confirmationMsg.className = 'max-w-2xl mx-auto bg-blue-900/50 p-6 rounded-lg border border-blue-700 shadow-lg';
        confirmationMsg.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <h3 class="text-lg font-semibold text-blue-100">Step 1: Sign the Safe Transaction</h3>
          </div>
          <div class="bg-blue-900/50 p-4 rounded-lg space-y-3">
            <p class="text-blue-200 text-sm">Please review and sign the Safe transaction details in your wallet:</p>
            <div class="space-y-2 font-mono text-sm">
              <p class="flex justify-between">
                <span class="text-blue-400">To:</span>
                <span class="text-blue-200">${truncateAddress(localTxData.to)}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Value:</span>
                <span class="text-blue-200">${ethers.formatEther(valueHex)} ETH</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Data:</span>
                <span class="text-blue-200">${dataHex === '0x' ? 'None' : truncateAddress(dataHex)}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Operation:</span>
                <span class="text-blue-200">Call (0)</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Nonce:</span>
                <span class="text-blue-200">${nonce}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Safe Tx Hash:</span>
                <span class="text-blue-200">${truncateAddress(this.selectedTxHash)}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Network:</span>
                <span class="text-blue-200">${this.selectedNetwork.displayName}</span>
              </p>
            </div>
          </div>
        `;
        this.buffer.appendChild(confirmationMsg);

        // Request signature from user
        console.log('Requesting signature for hash:', formattedHash);
        const signature = await this.signClient.request(signRequest);
        console.log('Received signature:', signature);

        // Step 2: Call signTx with the received signature
        // Create interface with the correct function signature
        const iface = new ethers.Interface([
          "function signTx(bytes32 txHash, bytes calldata signature) external",
        ]);

        // Encode the function call with both parameters
        const encodedTxData = iface.encodeFunctionData("signTx", [formattedHash, signature]);

        // Get current gas prices
        // Use utility function to prepare transaction request
        const request = await prepareTransactionRequest({
          provider: this.provider,
          signerAddress: this.signerAddress!,
          sessionTopic: this.sessionTopic!,
          selectedNetwork: this.selectedNetwork,
          contractAddress: contractAddresses.safeTxPool,
          encodedTxData,
          requestId: Math.floor(Math.random() * 1000000)
        });

        // Get gas limit from the request for UI display
        const gasLimitHex = request.request.params[0].gasLimit;
        const displayGasLimit = parseInt(gasLimitHex, 16);
        // Get max fee values from the request for display
        const maxFeePerGasHex = request.request.params[0].maxFeePerGas;
        const maxPriorityFeePerGasHex = request.request.params[0].maxPriorityFeePerGas;
        const maxFeePerGas = maxFeePerGasHex ? ethers.formatUnits(parseInt(maxFeePerGasHex, 16), 'gwei') : '10';
        const maxPriorityFeePerGas = maxPriorityFeePerGasHex ? ethers.formatUnits(parseInt(maxPriorityFeePerGasHex, 16), 'gwei') : '1';

        // Show signing confirmation UI for the second step
        this.buffer.innerHTML = '';
        const step2Msg = document.createElement('div');
        step2Msg.className = 'max-w-2xl mx-auto bg-blue-900/50 p-6 rounded-lg border border-blue-700 shadow-lg';
        step2Msg.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <h3 class="text-lg font-semibold text-blue-100">Step 2: Submit Signature to Contract</h3>
          </div>
          <div class="bg-blue-900/50 p-4 rounded-lg space-y-3">
            <p class="text-blue-200 text-sm">Please confirm the transaction to submit your signature:</p>
            <div class="space-y-2 font-mono text-sm">
              <p class="flex justify-between">
                <span class="text-blue-400">Function:</span>
                <span class="text-blue-200">signTx(bytes32, bytes)</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Contract:</span>
                <span class="text-blue-200">${truncateAddress(contractAddresses.safeTxPool)}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Transaction Hash:</span>
                <span class="text-blue-200">${truncateAddress(this.selectedTxHash || '')}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Network:</span>
                <span class="text-blue-200">${this.selectedNetwork.displayName}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Gas Limit:</span>
                <span class="text-blue-200">${`0x${displayGasLimit.toString(16)}`}</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Max Fee:</span>
                <span class="text-blue-200">${maxFeePerGas} Gwei</span>
              </p>
              <p class="flex justify-between">
                <span class="text-blue-400">Priority Fee:</span>
                <span class="text-blue-200">${maxPriorityFeePerGas} Gwei</span>
              </p>
            </div>
          </div>
        `;
        this.buffer.appendChild(step2Msg);

        // Send the transaction
        console.log('Sending transaction request:', request);
        const txHash = await this.signClient.request(request);

        // Show success message
        this.buffer.innerHTML = '';
        const successMsg = document.createElement('div');
        successMsg.className = 'max-w-2xl mx-auto bg-green-900/50 p-6 rounded-lg border border-green-700 shadow-lg';
        successMsg.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <h3 class="text-lg font-semibold text-green-100">Transaction Signed Successfully</h3>
          </div>
          <div class="bg-green-900/50 p-4 rounded-lg space-y-3">
            <div class="font-mono text-sm">
              <p class="text-green-400 mb-1">Transaction Hash:</p>
              <p class="text-green-200 break-all">${txHash}</p>
            </div>
            <p class="text-green-200 text-sm mt-4">The transaction has been signed. Use :l to refresh the transaction list.</p>
          </div>
        `;
        this.buffer.appendChild(successMsg);

      } catch (error: unknown) {
        console.error('Failed to sign transaction:', error);
        
        // Handle user rejection
        if (error instanceof Error && 
            (error.message.toLowerCase().includes('rejected') || 
             error.message.toLowerCase().includes('user denied'))) {
          this.buffer.innerHTML = '';
          const rejectionMsg = document.createElement('div');
          rejectionMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
          rejectionMsg.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
              <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <h3 class="text-lg font-semibold text-yellow-100">Signature Cancelled</h3>
            </div>
            <p class="text-yellow-100">You've cancelled the signing request.</p>
          `;
          this.buffer.appendChild(rejectionMsg);
          return;
        }
        
        // Handle session errors
        if (error instanceof Error && 
            (error.message.includes('session topic') || 
             error.message.includes('No matching key') ||
             error.message.includes('expired'))) {
          this.sessionTopic = null;
          this.signerAddress = null;
          this.signerAddressDisplay.textContent = '';
          
          this.buffer.innerHTML = '';
          const reconnectMsg = document.createElement('div');
          reconnectMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
          reconnectMsg.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
              <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              <h3 class="text-lg font-semibold text-yellow-100">Session Expired</h3>
            </div>
            <p class="text-yellow-100 mb-4">Your wallet connection has expired.</p>
            <div class="bg-yellow-900/50 p-4 rounded-lg text-sm">
              <p class="text-yellow-200 mb-2">Please reconnect your wallet:</p>
              <ol class="list-decimal list-inside text-yellow-100 space-y-1">
                <li>Use :wc command to reconnect your wallet</li>
                <li>Try signing the transaction again</li>
              </ol>
            </div>
          `;
          this.buffer.appendChild(reconnectMsg);
          return;
        }
        
        // Handle other errors
        this.buffer.innerHTML = '';
        const errorMsg = document.createElement('div');
        errorMsg.className = 'max-w-2xl mx-auto bg-red-900/50 p-6 rounded-lg border border-red-700 shadow-lg';
        errorMsg.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <h3 class="text-lg font-semibold text-red-100">Signing Failed</h3>
          </div>
          <p class="text-red-100 mb-4">An error occurred while signing the transaction:</p>
          <div class="bg-red-900/50 p-4 rounded-lg">
            <p class="text-red-200 font-mono text-sm break-all">${error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        `;
        this.buffer.appendChild(errorMsg);
      } finally {
        // Reset connecting flag
        this.isConnecting = false;
      }
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
    } else if (this.command === ':e') {
      // Check if we're already connecting to prevent duplicate requests
      if (this.isConnecting) {
        console.log('Connection already in progress, ignoring :e command');
        return;
      }
      
      if (!this.selectedTxHash) {
        this.buffer.textContent = 'Please select a transaction to execute';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      if (!this.signerAddress) {
        this.buffer.textContent = 'Please connect a wallet first using :wc';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      if (!this.signClient || !this.sessionTopic) {
        this.buffer.textContent = 'WalletConnect session not found. Please reconnect using :wc';
        this.buffer.className = 'flex-1 p-4 overflow-y-auto text-yellow-400';
        return;
      }

      await this.executeSelectedTransaction();
    } else if (this.command === ':h') {
      this.showHelpGuide();
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
    helperText.textContent = 'Fill in the transaction details and use :p command to propose the transaction.';
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

  private async proposeToSafeTxPool(): Promise<void> {
    console.log('Proposing transaction to SafeTxPool');
    
    if (!this.txFormData) {
      console.error('No transaction data to propose');
      return;
    }
    
    // Log the txFormData being proposed
    console.log('Proposing transaction with data:', JSON.stringify(this.txFormData));
    
    // Check if the data field is non-empty for ERC20 transfers
    if (this.txFormData.data && this.txFormData.data.startsWith('0xa9059cbb')) {
      console.log('This appears to be an ERC20 transfer. Decoded data:');
      try {
        const erc20Interface = new ethers.Interface([
          "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const decoded = erc20Interface.parseTransaction({ data: this.txFormData.data });
        if (decoded) {
          console.log('Decoded transfer:', decoded);
          console.log('  - To:', decoded.args[0]);
          console.log('  - Amount:', decoded.args[1].toString());
        }
      } catch (error) {
        console.error('Error decoding ERC20 transfer data:', error);
      }
    }
    
    // Check both proposing and connecting flags 
    if (this._isProposing || this.isConnecting || !this.txFormData) {
      if (this.isConnecting) {
        console.log('Connection already in progress, ignoring transaction proposal');
      }
      return;
    }
    
    this._isProposing = true;
    this.isConnecting = true; // Also set isConnecting to true

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
      const nonce = await getSafeNonce(this.safeAddress, this.provider);
      
      // Convert value to hex
      const valueHex = localTxData.value.startsWith('0x') ? 
        localTxData.value : 
        `0x${ethers.parseEther(localTxData.value).toString(16)}`;
      
      // Ensure data is hex
      const dataHex = localTxData.data.startsWith('0x') ? localTxData.data : `0x${localTxData.data}`;

      // Get hash from Safe contract
      const safeTxHash = await getSafeTxHashFromContract(
        localTxData.to,
        valueHex,
        dataHex,
        0,
        nonce,
        this.safeAddress,
        this.provider
      );

      // Encode function data for the transaction to display in UI
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

      // Decode the transaction data for display
      const decodedData = iface.parseTransaction({ data: encodedTxData });
      if (!decodedData) {
        throw new Error('Failed to decode transaction data');
      }
      const functionName = decodedData.name;
      const args = decodedData.args;

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

      // Create a more detailed transaction summary
      const detailedSummary = document.createElement('div');
      detailedSummary.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg mb-4';
      detailedSummary.innerHTML = `
        <h3 class="text-xl font-bold text-white mb-4">Transaction Details</h3>
        <div class="space-y-4">
          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Function Call</h4>
            <p class="font-mono text-sm text-blue-400">${functionName}</p>
          </div>
          
          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Arguments</h4>
            <div class="space-y-2 font-mono text-sm">
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Safe Tx Hash:</span>
                <span class="text-gray-300 col-span-2 break-all">${args[0]}</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Safe:</span>
                <span class="text-gray-300 col-span-2 break-all">${args[1]}</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">To:</span>
                <span class="text-gray-300 col-span-2 break-all">${args[2]}</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Value:</span>
                <span class="text-gray-300 col-span-2">${ethers.formatEther(args[3])} ETH</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Data:</span>
                <span class="text-gray-300 col-span-2 break-all">${args[4]}</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Operation:</span>
                <span class="text-gray-300 col-span-2">${args[5]} (Call)</span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <span class="text-gray-500">Nonce:</span>
                <span class="text-gray-300 col-span-2">${args[6]}</span>
              </div>
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

          <div class="bg-gray-900 p-4 rounded-lg">
            <h4 class="text-sm font-medium text-gray-400 mb-2">Raw Transaction Data</h4>
            <p class="font-mono text-xs text-gray-300 break-all">${encodedTxData}</p>
          </div>
        </div>
      `;

      // Clear previous content and show the detailed summary
      this.buffer.innerHTML = '';
      this.buffer.appendChild(detailedSummary);

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

      // Prepare transaction request
      const request = await prepareTransactionRequest({
        provider: this.provider,
        signerAddress: this.signerAddress!,
        sessionTopic: this.sessionTopic!,
        selectedNetwork: this.selectedNetwork,
        contractAddress: contractAddresses.safeTxPool,
        encodedTxData,
        requestId: Math.floor(Math.random() * 1000000)
      });

      // Add transaction summary to the UI before sending
      const txSummary = document.createElement('div');
      txSummary.className = 'max-w-2xl mx-auto mt-4 bg-blue-900/50 p-6 rounded-lg border border-blue-700 shadow-lg';
      txSummary.innerHTML = `
        <div class="flex items-center gap-3 mb-4">
          <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <h3 class="text-lg font-semibold text-blue-100">Waiting for Wallet Confirmation</h3>
        </div>
        <div class="bg-blue-900/50 p-4 rounded-lg space-y-3">
          <p class="text-blue-200 text-sm">Please confirm the transaction in your wallet. You will be proposing:</p>
          <div class="space-y-2 font-mono text-sm">
            <p class="flex justify-between">
              <span class="text-blue-400">Function:</span>
              <span class="text-blue-200">proposeTx()</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">Contract:</span>
              <span class="text-blue-200">${truncateAddress(contractAddresses.safeTxPool)}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">Safe:</span>
              <span class="text-blue-200">${truncateAddress(this.safeAddress)}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">To:</span>
              <span class="text-blue-200">${truncateAddress(localTxData.to)}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">Value:</span>
              <span class="text-blue-200">${ethers.formatEther(valueHex)} ETH</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">Nonce:</span>
              <span class="text-blue-200">${nonce}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-blue-400">Hash:</span>
              <span class="text-blue-200">${truncateAddress(safeTxHash)}</span>
            </p>
          </div>
        </div>
      `;
      this.buffer.appendChild(txSummary);

      // Send the transaction with proper error handling
      let txHash;
      try {
        // Send the request and wait for response
        txHash = await this.signClient.request(request);
        
        if (!txHash || typeof txHash !== 'string') {
          throw new Error('Invalid transaction hash received');
        }
      } catch (error: any) {
        console.error('Transaction request failed:', error);
        
        // Handle user rejection
        if (error?.message?.toLowerCase().includes('rejected') || 
            error?.message?.toLowerCase().includes('user denied')) {
          
          // Show user-friendly rejection message
          this.buffer.innerHTML = '';
          const rejectionMsg = document.createElement('div');
          rejectionMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
          rejectionMsg.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
              <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <h3 class="text-lg font-semibold text-yellow-100">Transaction Cancelled</h3>
            </div>
            <p class="text-yellow-100 mb-4">You've rejected the transaction from your wallet.</p>
            <div class="bg-yellow-900/50 p-4 rounded-lg text-sm">
              <p class="text-yellow-200 mb-2">What you can do next:</p>
              <ul class="list-disc list-inside text-yellow-100 space-y-1">
                <li>Review the transaction details and try again</li>
                <li>Use :t to create a new transaction</li>
                <li>Use :l to view pending transactions</li>
              </ul>
            </div>
          `;
          this.buffer.appendChild(rejectionMsg);
          return;
        }
        
        // Handle session errors
        if (error?.message?.includes('session topic') || 
            error?.message?.includes('No matching key') ||
            error?.message?.includes('expired')) {
          this.sessionTopic = null;
          this.signerAddress = null;
          this.signerAddressDisplay.textContent = '';
          
          this.buffer.innerHTML = '';
          const reconnectMsg = document.createElement('div');
          reconnectMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
          reconnectMsg.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
              <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              <h3 class="text-lg font-semibold text-yellow-100">Session Expired</h3>
            </div>
            <p class="text-yellow-100 mb-4">Your wallet connection has expired.</p>
            <div class="bg-yellow-900/50 p-4 rounded-lg text-sm">
              <p class="text-yellow-200 mb-2">Please reconnect your wallet:</p>
              <ol class="list-decimal list-inside text-yellow-100 space-y-1">
                <li>Use :wc command to reconnect your wallet</li>
                <li>Try proposing the transaction again</li>
              </ol>
            </div>
          `;
          this.buffer.appendChild(reconnectMsg);
          return;
        }
        
        // Handle other errors with improved UI
      this.buffer.innerHTML = '';
        const errorMsg = document.createElement('div');
        errorMsg.className = 'max-w-2xl mx-auto bg-red-900/50 p-6 rounded-lg border border-red-700 shadow-lg';
        errorMsg.innerHTML = `
          <div class="flex items-center gap-3 mb-4">
            <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <h3 class="text-lg font-semibold text-red-100">Transaction Failed</h3>
          </div>
          <p class="text-red-100 mb-4">An error occurred while processing your transaction:</p>
          <div class="bg-red-900/50 p-4 rounded-lg">
            <p class="text-red-200 font-mono text-sm break-all">${error?.message || 'Unknown error'}</p>
          </div>
          <div class="mt-4 text-sm text-red-200">
            Please verify your wallet connection and try again.
          </div>
        `;
        this.buffer.appendChild(errorMsg);
        return;
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
      this.isConnecting = false; // Reset isConnecting flag
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
              ensNames[owner] = await resolveEnsName(owner, this.provider);
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
    container.tabIndex = 0; // Make container focusable
    container.id = 'safe-info-container';

    // Create title
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-4';
    title.textContent = 'Safe Information';
    container.appendChild(title);
    
    // Create tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'border-b border-gray-700 mb-4';
    const tabsList = document.createElement('div');
    tabsList.className = 'flex';
    
    // Create tabs
    const tabs = [
      { id: 'info', label: 'Info' },
      { id: 'assets', label: 'Assets' }
    ];
    
    const tabBodies: {[key: string]: HTMLDivElement} = {};
    const tabButtons: HTMLButtonElement[] = [];
    
    // Function to switch tabs
    const switchToTab = (tabIndex: number) => {
      // Ensure index is within bounds
      const index = Math.max(0, Math.min(tabIndex, tabs.length - 1));
      
      // Remove active class from all tabs
      tabButtons.forEach(btn => {
        btn.className = 'py-2 px-4 font-medium text-gray-400 hover:text-blue-300';
      });
      
      // Hide all tab contents
      Object.values(tabBodies).forEach(content => {
        content.style.display = 'none';
      });
      
      // Set active tab
      tabButtons[index].className = 'py-2 px-4 font-medium text-blue-400 border-b-2 border-blue-400';
      const tabId = tabs[index].id;
      tabBodies[tabId].style.display = 'block';
      
      // If switching to the Assets tab, find and focus the token table
      if (tabId === 'assets') {
        // Use a short timeout to ensure DOM is updated before focusing
        setTimeout(() => {
          const tokenTable = document.getElementById('token-table');
          if (tokenTable) {
            console.log('Focusing token table from tab switch');
            tokenTable.focus();
            
            // Also trigger the first row selection
            const updateFocusFunction = (window as any).currentTokenTableUpdateFocus;
            if (typeof updateFocusFunction === 'function') {
              updateFocusFunction(0);
            }
          }
        }, 100);
      } else {
        // When switching to non-Assets tab, ensure the container remains focused
        setTimeout(() => {
          // Re-focus the container to keep keyboard navigation working
          container.focus();
          console.log('Re-focusing container for tab:', tabId);
        }, 50);
      }
    };
    
    // Create tab buttons
    tabs.forEach((tab, index) => {
      const tabButton = document.createElement('button');
      tabButton.className = `py-2 px-4 font-medium ${index === 0 ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-blue-300'}`;
      tabButton.textContent = tab.label;
      tabButton.dataset.tab = tab.id;
      tabButton.dataset.index = index.toString();
      
      // Store reference to button
      tabButtons.push(tabButton);
      
      // Create tab content container
      const tabContent = document.createElement('div');
      tabContent.className = 'tab-content';
      tabContent.id = `${tab.id}-content`;
      tabContent.style.display = index === 0 ? 'block' : 'none';
      tabBodies[tab.id] = tabContent;
      
      // Add click event
      tabButton.addEventListener('click', () => {
        switchToTab(index);
        // Focus the container after handling the click
        setTimeout(() => container.focus(), 50);
      });
      
      tabsList.appendChild(tabButton);
    });
    
    // Add keyboard navigation for tabs
    container.addEventListener('keydown', (e) => {
      // Get currently active tab index
      const activeTabIndex = tabButtons.findIndex(btn => 
        btn.className.includes('text-blue-400')
      );
      
      if (e.key === 'ArrowRight') {
        // Switch to next tab if possible
        if (activeTabIndex < tabs.length - 1) {
          switchToTab(activeTabIndex + 1);
          e.preventDefault(); // Prevent default scrolling
        }
      } else if (e.key === 'ArrowLeft') {
        // Switch to previous tab if possible
        if (activeTabIndex > 0) {
          switchToTab(activeTabIndex - 1);
          e.preventDefault(); // Prevent default scrolling
        }
      }
    });
    
    tabsContainer.appendChild(tabsList);
    container.appendChild(tabsContainer);
    
    // Create the Info tab content
    tabsContainer.appendChild(tabsList);
    container.appendChild(tabsContainer);
    
    // Create the Info tab content
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
    tabBodies['info'].appendChild(infoBox);
    
    // Create the Assets tab content
    const assetsBox = document.createElement('div');
    assetsBox.className = 'bg-gray-700 p-4 rounded-lg';
    
    // Show loading indicator initially
    assetsBox.innerHTML = `
      <div class="flex justify-center items-center p-4">
        <span class="text-gray-400">Loading token balances...</span>
      </div>
    `;
    
    tabBodies['assets'].appendChild(assetsBox);
    
    // Add tab bodies to container
    Object.values(tabBodies).forEach(content => {
      container.appendChild(content);
    });
    
    this.buffer.appendChild(container);
    
    // Fetch token balances
    this.fetchTokenBalances(assetsBox);
    
    // Focus the container immediately 
    setTimeout(() => {
      container.focus();
      console.log('Initial focus on Safe info container');
      
      // Add subtle visual indicator for keyboard focus
      container.style.outline = '2px solid #3b82f6';
      container.style.outlineOffset = '2px';
    }, 100);
  }
  
  // New method to fetch and display token balances
  private async fetchTokenBalances(container: HTMLElement): Promise<void> {
    if (!this.safeAddress || !this.provider) {
      container.innerHTML = `
        <div class="p-4 text-center">
          <span class="text-red-400">Error: No safe address or provider available</span>
        </div>
      `;
      return;
    }
    
    try {
      // Get native token (ETH) balance
      const ethBalance = await this.provider.getBalance(this.safeAddress);
      
      // Clear loading and set up table
      container.innerHTML = '';
      
      // Add title
      const title = document.createElement('div');
      title.className = 'mb-3 pb-2 border-b border-gray-600';
      title.innerHTML = `
        <h4 class="text-white font-medium">Token Balances</h4>
        <p class="text-gray-400 text-xs">Safe: ${truncateAddress(this.safeAddress)}</p>
      `;
      container.appendChild(title);
      
      // Create token list container with similar structure to tx table
      const tokenTable = document.createElement('div');
      tokenTable.id = 'token-table';
      tokenTable.className = 'w-full text-sm bg-gray-800 rounded-lg overflow-hidden outline-none focus:ring-2 focus:ring-blue-500';
      tokenTable.tabIndex = 0; // Make it focusable
      
      // Add focus styles to make it obvious when focused
      tokenTable.addEventListener('focus', () => {
        console.log('Token table focused');
        // Add a highlighted border when focused - use the exact same style as pending tx screen
        tokenTable.classList.add('ring-2', 'ring-blue-500');
      });
      
      tokenTable.addEventListener('blur', () => {
        console.log('Token table blurred');
        // Remove styles when losing focus
        tokenTable.classList.remove('ring-2', 'ring-blue-500');
      });
      
      // Create header
      const header = document.createElement('div');
      header.className = 'grid grid-cols-3 text-left text-gray-400 border-b border-gray-600 bg-gray-800 p-3 font-medium';
      header.innerHTML = `
        <div>Asset</div>
        <div class="text-right">Balance</div>
        <div class="text-right">Value</div>
      `;
      tokenTable.appendChild(header);
      
      // Get network specific ETH name directly from the network config
      const nativeCurrencyName = this.selectedNetwork.nativeTokenName;
      
      // Check if connected wallet is owner of the safe
      const isOwner = this.signerAddress && this.cachedSafeInfo?.owners.some(
        owner => owner.toLowerCase() === this.signerAddress?.toLowerCase()
      );
      
      // Store token data for navigation
      const tokenData: Token[] = [];
      let currentFocusIndex = 0;
      const self = this; // Reference to VimApp instance
      
      // Create ETH token object
      const ethToken: Token = {
        symbol: 'ETH',
        name: nativeCurrencyName,
        balanceFormatted: ethers.formatEther(ethBalance),
        balance: ethBalance.toString(),
        address: 'ETH', // Special case for ETH
        decimals: 18
      };
      
      // Get ETH price for USD value calculation
      const ethPrice = await PriceOracle.getEthPrice(this.provider);
      ethToken.valueUsd = parseFloat(ethToken.balanceFormatted) * ethPrice;
      
      // Add ETH token to the data array
      tokenData.push(ethToken);
      
      // Create ETH row (similar to transaction rows in pending tx screen)
      const ethRow = document.createElement('div');
      ethRow.setAttribute('data-token-address', 'ETH');
      ethRow.className = 'border-b border-gray-700 hover:bg-gray-750 cursor-pointer transition-colors duration-150 ease-in-out';
      
      // Format ETH row content
      const ethRowContent = document.createElement('div');
      ethRowContent.className = 'grid grid-cols-3 p-3 items-center';
      ethRowContent.innerHTML = `
        <div class="flex items-center space-x-2">
          <div class="p-1 rounded-full bg-blue-100">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24Z" fill="#627EEA"/>
              <path d="M12.3735 3V9.6525L17.9961 12.165L12.3735 3Z" fill="white" fill-opacity="0.602"/>
              <path d="M12.3735 3L6.75 12.165L12.3735 9.6525V3Z" fill="white"/>
              <path d="M12.3735 16.4759V20.9964L18 13.2119L12.3735 16.4759Z" fill="white" fill-opacity="0.602"/>
              <path d="M12.3735 20.9964V16.4758L6.75 13.2119L12.3735 20.9964Z" fill="white"/>
              <path d="M12.3735 15.4296L17.9961 12.1649L12.3735 9.65479V15.4296Z" fill="white" fill-opacity="0.2"/>
              <path d="M6.75 12.1649L12.3735 15.4296V9.65479L6.75 12.1649Z" fill="white" fill-opacity="0.602"/>
            </svg>
          </div>
          <span class="font-medium text-white">ETH</span>
        </div>
        <div class="text-right font-mono text-white">${ethToken.balanceFormatted} ETH</div>
        <div class="text-right text-gray-300">$${ethToken.valueUsd ? ethToken.valueUsd.toFixed(2) : '0.00'}</div>
      `;
      
      ethRow.appendChild(ethRowContent);
      tokenTable.appendChild(ethRow);
      
      // Fetch ERC20 tokens from our token indexing service
      try {
        // Construct API URL to our token service
        const baseUrl = window.location.hostname === 'localhost' ? 
          'http://localhost:3000' : 
          window.location.origin;
        
        // Use chainId directly from the provider instead of separate RPC URL
        const tokenServiceUrl = `${baseUrl}/tokens/${this.safeAddress}?chainId=${this.selectedNetwork.chainId}`;
        
        // Fetch token balances
        const response = await fetch(tokenServiceUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const tokens = await response.json();
        
        // If no tokens were found, show a message
        if (tokens.length === 0) {
          const noTokensRow = document.createElement('div');
          noTokensRow.className = 'p-4 text-center text-gray-400 italic';
          noTokensRow.textContent = 'No ERC20 tokens found for this address';
          tokenTable.appendChild(noTokensRow);
        } else {
          // Add rows for each token
          tokens.forEach((token: Token) => {
            // Add to token data array
            tokenData.push(token);
            
            // Create token row
            const tokenRow = document.createElement('div');
            tokenRow.setAttribute('data-token-address', token.address);
            tokenRow.className = 'border-b border-gray-700 hover:bg-gray-750 cursor-pointer transition-colors duration-150 ease-in-out';
            
            // Generate random color for token icon background
            const colors = ['bg-red-100', 'bg-green-100', 'bg-blue-100', 'bg-yellow-100', 'bg-purple-100', 'bg-pink-100'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            // Format value if available
            const valueDisplay = token.valueUsd != null
              ? `$${token.valueUsd.toFixed(2)}`
              : '$0.00';
            
            tokenRow.innerHTML = `
              <div class="grid grid-cols-3 p-3 items-center">
                <div class="flex items-center space-x-2">
                  <div class="p-1 rounded-full ${randomColor}">
                    <div class="w-6 h-6 flex items-center justify-center font-bold text-gray-800">
                      ${token.symbol.charAt(0)}
                    </div>
                  </div>
                  <span class="font-medium text-white">${token.symbol}</span>
                </div>
                <div class="text-right font-mono text-white">${token.balanceFormatted} ${token.symbol}</div>
                <div class="text-right text-gray-300">${valueDisplay}</div>
              </div>
            `;
            
            tokenTable.appendChild(tokenRow);
          });
        }
      } catch (tokenError: unknown) {
        console.error('Error fetching ERC20 tokens:', tokenError);
        
        // Show error message for token fetch
        const errorRow = document.createElement('div');
        errorRow.className = 'p-4 text-center text-red-400';
        errorRow.textContent = tokenError instanceof Error ? tokenError.message : 'Unknown error fetching ERC20 tokens';
        tokenTable.appendChild(errorRow);
      }
      
      container.appendChild(tokenTable);
      
      // Add help text (similar to pending tx screen)
      const helpText = document.createElement('p');
      helpText.className = 'text-center text-gray-400 text-xs mt-4';
      helpText.textContent = 'Use ↑/↓ keys to navigate, Enter to send token, : to enter command mode';
      container.appendChild(helpText);
      
      // Function to update focus (similar to pending tx screen)
      const updateFocus = (index: number) => {
        console.log(`Updating focus to index ${index}`);
        const rows = tokenTable.querySelectorAll('div[data-token-address]');
        if (rows.length === 0) return;
        
        // Limit index to valid range
        currentFocusIndex = Math.max(0, Math.min(index, rows.length - 1));
        
        // Remove active class from all rows
        rows.forEach((row, i) => {
          row.classList.remove('bg-gray-700', 'selected-token', 'border-l-4', 'border-l-blue-500');
          
          // Reset any modified padding
          const content = row.querySelector('.grid');
          if (content) {
            content.classList.remove('pl-2');
          }
        });
        
        // Get the row to focus
        const rowToFocus = rows[currentFocusIndex];
        if (!rowToFocus) return;
        
        // Add very distinctive styling to the selected row - exactly like pending tx screen
        rowToFocus.classList.add('bg-gray-700', 'selected-token', 'border-l-4', 'border-l-blue-500');
        
        // Adjust padding for the content to account for the border
        const content = rowToFocus.querySelector('.grid');
        if (content) {
          content.classList.add('pl-2');
        }
        
        // Make sure the focused row is visible
        rowToFocus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        
        console.log(`Focus updated to token at index ${currentFocusIndex}`);
      };
      
      // Make updateFocus globally accessible for tab switching
      (window as any).currentTokenTableUpdateFocus = updateFocus;
      
      // Add keyboard navigation (similar to pending tx screen)
      tokenTable.addEventListener('keydown', (e: KeyboardEvent) => {
        const totalTokens = tokenData.length;
        console.log('Token table keydown:', e.key); // Debug logging
        
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            if (currentFocusIndex > 0) {
              updateFocus(currentFocusIndex - 1);
            }
            break;
            
          case 'ArrowDown':
            e.preventDefault();
            if (currentFocusIndex < totalTokens - 1) {
              updateFocus(currentFocusIndex + 1);
            }
            break;
            
          case 'Enter':
            e.preventDefault();
            // Only allow token sending if user is an owner
            if (isOwner) {
              const token = tokenData[currentFocusIndex];
              if (token) {
                // Highlight the selected row with more prominent styling
                const selectedRow = tokenTable.querySelectorAll('div[data-token-address]')[currentFocusIndex];
                if (selectedRow) {
                  // Ensure the row stays selected
                  tokenTable.querySelectorAll('div[data-token-address]').forEach(row => {
                    row.classList.remove('bg-gray-700', 'selected-token');
                  });
                  selectedRow.classList.add('bg-gray-700', 'selected-token');
                }
                
                // Show token sending screen
                self.showTokenSendingScreen(token);
              }
            }
            break;
            
          case ':':
            e.preventDefault();
            // Focus the command input when colon is pressed
            if (self.commandInput) {
              self.commandInput.focus();
              // Prepopulate with colon
              self.commandInput.value = ':';
              // Set cursor position after the colon
              self.commandInput.setSelectionRange(1, 1);
            }
            break;
        }
      });
      
      // Add click handlers for rows
      const rows = tokenTable.querySelectorAll('div[data-token-address]');
      rows.forEach((row, index) => {
        row.addEventListener('click', () => {
          // First explicitly focus the token table
          console.log('Token row clicked, focusing table');
          tokenTable.focus();
          
          // Update focus with animation to make it obvious
          updateFocus(index);
          
          // If owner, handle double-click separately
          if (isOwner) {
            // Track clicks for double-click detection
            const now = new Date().getTime();
            const lastClick = (row as any)._lastClickTime || 0;
            (row as any)._lastClickTime = now;
            
            // If double click (within 300ms), show token sending screen
            if (now - lastClick < 300) {
              console.log('Double click detected, showing token sending screen');
              const token = tokenData[index];
              if (token) {
                self.showTokenSendingScreen(token);
              }
            }
          }
        });
      });
      
      // Set initial focus
      setTimeout(() => {
        console.log('Setting initial focus on token table');
        // Add obvious focus styles to the token table
        tokenTable.style.outline = '2px solid #3b82f6';
        tokenTable.focus({preventScroll: false});
        updateFocus(0);
      }, 100);
      
    } catch (error: unknown) {
      console.error('Error fetching token balances:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      container.innerHTML = `
        <div class="p-4 text-center">
          <span class="text-red-400">Error fetching token balances: ${errorMessage}</span>
        </div>
      `;
    }
  }

  private updateTitle(): void {
    document.title = this.safeAddress ? 
      `Safe ${truncateAddress(this.safeAddress)} - Minimalist Safe{Wallet}` : 
      'Minimalist Safe{Wallet}';
  }

  private async initializeWalletConnect(chainId: number): Promise<void> {
    // Prevent duplicate connection attempts by checking if already connecting
    if (this.isConnecting) {
      console.log('Wallet connection already in progress, ignoring duplicate request');
      return;
    }
    
    try {
      // Set connecting flag to prevent duplicate requests
      this.isConnecting = true;
      
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
    } finally {
      // Reset connecting flag
      this.isConnecting = false;
    }
  }

  // Add this new private method after proposeToSafeTxPool method
  private async executeSelectedTransaction(): Promise<void> {
    if (!this.selectedTxHash || !this.signClient || !this.sessionTopic || !this.signerAddress) {
      this.buffer.textContent = 'Error: No transaction selected or wallet not connected.';
      return;
    }

    // Prevent duplicate transaction executions
    if (this.isConnecting) {
      console.log('Connection already in progress, ignoring transaction execution');
      return;
    }

    try {
      // Set connecting flag to prevent duplicate requests
      this.isConnecting = true;
      
      // Get signer account
      const signerAccount = this.signerAddress;
      if (!signerAccount) throw new Error('Failed to get signer account');

      // Get cached Safe info for threshold
      if (!this.cachedSafeInfo) {
        await this.loadAndCacheSafeInfo();
      }
      
      // Get contract address for current network
      const contractAddresses = getContractAddress(this.selectedNetwork);
      
      // Get transaction details from the SafeTxPool contract
      const safeTxPool = new SafeTxPool(contractAddresses.safeTxPool, this.selectedNetwork);
      let txDetails;
      try {
        txDetails = await safeTxPool.getTransactionDetails(this.selectedTxHash);
      } catch (error) {
        console.error("Error fetching transaction details:", error);
        throw new Error(`Failed to retrieve transaction details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      if (!txDetails || !txDetails.to) {
        throw new Error('Invalid transaction: missing required fields');
      }
      
      // Get signatures array
      const signatures = txDetails.signatures || [];
      
      // Format signatures for Safe contract
      const formattedSignatures = formatSafeSignatures(signatures);
      
      // Create Safe transaction parameters
      const safeInterface = new ethers.Interface([
        'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)'
      ]);

      // Ensure data is properly formatted
      const data = txDetails.data || '0x';
      const value = txDetails.value || '0x0';
      
      // Create the transaction parameters exactly as Safe expects them
      const params = [
        txDetails.to,
        value,
        data,
        txDetails.operation,
        0, // safeTxGas
        0, // baseGas
        0, // gasPrice
        ethers.ZeroAddress, // gasToken
        ethers.ZeroAddress, // refundReceiver
        formattedSignatures // Use the formatted signatures
      ];
      
      // Encode the transaction data
      const encodedTxData = safeInterface.encodeFunctionData('execTransaction', params);
      
      // Prepare transaction request
      const request = await prepareTransactionRequest({
        provider: this.provider,
        signerAddress: signerAccount,
        sessionTopic: this.sessionTopic!,
        selectedNetwork: this.selectedNetwork,
        contractAddress: txDetails.safe,
        encodedTxData,
        requestId: Math.floor(Math.random() * 1000000)
      });

      // Show execution confirmation UI
      this.buffer.innerHTML = '';
      const executionMsg = document.createElement('div');
      executionMsg.className = 'max-w-2xl mx-auto bg-yellow-900/50 p-6 rounded-lg border border-yellow-700 shadow-lg';
      executionMsg.innerHTML = `
        <div class="flex items-center gap-3 mb-4">
          <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <h3 class="text-lg font-semibold text-yellow-100">Executing Safe Transaction</h3>
        </div>
        <div class="bg-yellow-900/50 p-4 rounded-lg space-y-3">
          <p class="text-yellow-200 text-sm">Please review and confirm the Safe transaction details in your wallet:</p>
          <div class="space-y-2 font-mono text-sm">
            <p class="flex justify-between">
              <span class="text-yellow-400">To:</span>
              <span class="text-yellow-200">${truncateAddress(txDetails.to)}</span>
            </p>
            <p class="flex justify-between">
              <span class="text-yellow-400">Value:</span>
              <span class="text-yellow-200">${ethers.formatEther(value)} ETH</span>
            </p>
            <p class="flex justify-between">
              <span class="text-yellow-400">Signatures:</span>
              <span class="text-yellow-200">${signatures.length}/${this.cachedSafeInfo?.threshold || 1}</span>
            </p>
            <div class="text-yellow-300 mt-2">
              <p>Please confirm this action in your wallet.</p>
              <p class="text-xs mt-1">Using formatted signatures for Safe execution.</p>
            </div>
          </div>
        </div>
      `;
      this.buffer.appendChild(executionMsg);

      // Send transaction
      let txHash;
      try {
        // Send the request and wait for response
        txHash = await this.signClient.request(request);
      } catch (error: any) {
        // Check if user rejected
        if (error?.message?.includes('rejected')) {
          this.buffer.innerHTML = '';
          const rejectionMsg = document.createElement('div');
          rejectionMsg.className = 'bg-yellow-900/50 p-4 rounded-lg text-yellow-200';
          rejectionMsg.innerHTML = `
            <p>Transaction rejected by user.</p>
            <p class="text-sm mt-2">You can try again when ready.</p>
          `;
          this.buffer.appendChild(rejectionMsg);
          return;
        }
        throw error;
      }

      // Get the explorer URL for the transaction
      const explorerUrl = getExplorerUrl(this.selectedNetwork.chainId);
      const txExplorerUrl = `${explorerUrl}/tx/${txHash}`;

      // Transaction succeeded message
      this.buffer.innerHTML = '';
      const successMsg = document.createElement('div');
      successMsg.className = 'max-w-2xl mx-auto bg-green-900/50 p-6 rounded-lg border border-green-700 shadow-lg';
      successMsg.innerHTML = `
        <div class="flex items-center gap-3 mb-4">
          <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
          <h3 class="text-lg font-semibold text-green-100">Transaction Submitted</h3>
        </div>
        <p class="text-green-200 mb-4">Your transaction has been submitted to the blockchain.</p>
        <div class="bg-green-900/50 p-4 rounded-lg">
          <p class="text-green-300 font-medium text-sm mb-2">Transaction Hash:</p>
          <p class="font-mono text-xs text-green-200 break-all mb-4">${txHash}</p>
          <a href="${txExplorerUrl}" target="_blank" class="inline-flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors">
            <span>View on Explorer</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
          </a>
        </div>
      `;
      this.buffer.appendChild(successMsg);
    } catch (error: any) {
      console.error("Error in transaction execution:", error);
      this.buffer.innerHTML = '';
      
      const errorDiv = document.createElement('div');
      errorDiv.className = 'max-w-2xl mx-auto bg-red-900/50 p-6 rounded-lg border border-red-700 shadow-lg';
      
      // Create a user-friendly error message
      let errorMessage = 'Transaction execution failed';
      let errorDetails = error.message || 'Unknown error occurred during transaction execution';
      
      errorDiv.innerHTML = `
        <div class="flex items-center gap-3 mb-4">
          <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <h3 class="text-xl font-semibold text-red-200">${errorMessage}</h3>
        </div>
        <div class="space-y-2">
          <p class="text-red-300 text-sm mt-2">${errorDetails}</p>
        </div>
      `;
      this.buffer.appendChild(errorDiv);
    } finally {
      // Reset connecting flag
      this.isConnecting = false;
    }
  }

  /**
   * Shows the token sending screen for a specific token
   * @param token The token to send (with ETH as a special case)
   */
  private showTokenSendingScreen(token: Token): void {
    console.log('Showing token sending screen for:', token);
    console.log(`Token decimals: ${token.decimals}, Raw balance: ${token.balance}, Formatted balance: ${token.balanceFormatted}`);
    
    // Check that the token has the decimal property
    if (token.decimals === undefined) {
      console.error('⚠️ ERROR: Token decimals information is missing!');
    } else {
      console.log(`Token decimals verification passed: ${token.decimals}`);
      
      // Verify that the balance parsing works correctly
      try {
        const testParse = ethers.parseUnits(token.balanceFormatted.replace(/,/g, ''), token.decimals);
        console.log(`Test parsing the token balance: ${testParse.toString()}`);
      } catch (error) {
        console.error('Error test parsing token balance:', error);
      }
    }
    
    // Clear existing content
    this.buffer.innerHTML = '';
    this.buffer.className = 'flex-1 p-4 overflow-y-auto';

    // Create transaction form container
    const formContainer = document.createElement('div');
    formContainer.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';

    // Create form title with token info
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-2';
    title.textContent = `Send ${token.symbol}`;
    
    // Add token info subtitle
    const subtitle = document.createElement('p');
    subtitle.className = 'text-gray-400 text-sm mb-6';
    subtitle.textContent = `Balance: ${token.balanceFormatted} ${token.symbol}`;

    // Create form
    const form = document.createElement('form');
    form.className = 'space-y-6';
    form.id = 'token-send-form';
    form.onsubmit = (e) => e.preventDefault();

    // Initialize txFormData based on token type
    const isEth = token.address === 'ETH';
    if (isEth) {
      // For ETH, we'll set the recipient and value
      this.txFormData = { to: '', value: '', data: '0x' };
    } else {
      // For ERC20, we'll call the token contract with transfer() function
      this.txFormData = { to: token.address, value: '0', data: '' };
      console.log('Initialized ERC20 transfer data structure');
      
      // Verify that ERC20 token decimal information is available
      if (token.decimals === undefined) {
        console.warn('Token decimals information is missing!');
      }
    }
    
    // Define fields for the token transfer form
    const fields = [
      {
        id: 'tx-to',
        label: 'To Address',
        type: 'combo',
        placeholder: '0x...',
        required: true
      },
      {
        id: 'tx-amount',
        label: `Amount (${token.symbol})`,
        type: 'text',
        placeholder: '0.0',
        required: true
      }
    ];

    // Create fields in the form
    fields.forEach(field => {
      const fieldContainer = document.createElement('div');
      fieldContainer.className = 'relative';

      const label = document.createElement('label');
      label.htmlFor = field.id;
      label.className = 'block text-sm font-medium text-gray-300 mb-1';
      label.textContent = field.label;

      let input: HTMLInputElement;
      if (field.type === 'combo') {
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
              if (isEth) {
                this.txFormData!.to = owner; // For ETH, recipient is the to field
              } else {
                // For ERC20, we need to update the transfer call data
                this.updateERC20TransferData(token.address, owner, 
                  (document.getElementById('tx-amount') as HTMLInputElement)?.value || '0', 
                  token.decimals);
              }
              dropdownContainer.classList.add('hidden');
            });
            
            dropdownContainer.appendChild(option);
          });
        }

        // Add input event listener to update txFormData and show/hide dropdown
        input.addEventListener('input', () => {
          const toAddress = input.value;
          if (isEth) {
            this.txFormData!.to = toAddress; // For ETH, recipient is the to field
          } else {
            // For ERC20, we need to update the transfer call data
            this.updateERC20TransferData(token.address, toAddress, 
              (document.getElementById('tx-amount') as HTMLInputElement)?.value || '0', 
              token.decimals);
          }
          dropdownContainer.classList.remove('hidden');
        });

        // Other event handlers...
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

        // Add keydown event listener for navigation
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
              const toAddress = input.value;
              if (isEth) {
                vimApp.txFormData!.to = toAddress; // For ETH, recipient is the to field
              } else {
                // For ERC20, we need to update the transfer call data
                vimApp.updateERC20TransferData(token.address, toAddress, 
                  (document.getElementById('tx-amount') as HTMLInputElement)?.value || '0', 
                  token.decimals);
              }
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
      } else {
        // For regular text inputs
        input = document.createElement('input');
        input.type = 'text';
        input.id = field.id;
        input.className = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
        input.placeholder = field.placeholder;
        if (field.required) input.required = true;

        // For amount field, add max button
        if (field.id === 'tx-amount') {
          const inputGroup = document.createElement('div');
          inputGroup.className = 'flex';
          
          // Debug the input with an ID for easy reference
          input.dataset.debug = 'amount-input';
          
          const maxButton = document.createElement('button');
          maxButton.type = 'button';
          maxButton.className = 'px-3 py-2 ml-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md';
          maxButton.textContent = 'MAX';
          maxButton.onclick = () => {
            // Set the maximum available balance
            console.log(`Setting MAX amount: ${token.balanceFormatted} ${token.symbol} (raw balance: ${token.balance}, decimals: ${token.decimals})`);
            
            // Ensure we use a clean value without formatting for the input
            const cleanValue = token.balanceFormatted.replace(/,/g, '');
            input.value = cleanValue;
            console.log(`Set amount input value to MAX: "${input.value}"`);
            
            // Update txFormData based on token type
            if (isEth) {
              // For ETH, use the value directly
              console.log(`Setting ETH value to MAX: ${input.value}`);
              this.txFormData!.value = input.value;
            } else {
              // For ERC20, update the transfer data
              const toAddress = (document.getElementById('tx-to') as HTMLInputElement)?.value || '';
              console.log(`Setting ERC20 transfer with MAX amount: "${cleanValue}" (${token.decimals} decimals)`);
              
              // Use cleanValue directly instead of reading from input.value
              this.updateERC20TransferData(token.address, toAddress, cleanValue, token.decimals);
              
              // Verify the data was set
              console.log(`After MAX: txFormData.data = ${this.txFormData?.data}`);
            }
          };
          
          inputGroup.appendChild(input);
          inputGroup.appendChild(maxButton);
          
          fieldContainer.appendChild(label);
          fieldContainer.appendChild(inputGroup);
        } else {
          fieldContainer.appendChild(label);
          fieldContainer.appendChild(input);
        }
        
        // Add input event listener to update txFormData in real-time
        input.addEventListener('input', () => {
          if (field.id === 'tx-to') {
            const toAddress = input.value;
            if (isEth) {
              this.txFormData!.to = toAddress; // For ETH, recipient is the to field
            } else {
              // For ERC20, update the transfer data
              const amountInput = document.getElementById('tx-amount') as HTMLInputElement;
              const amount = amountInput?.value || '';
              console.log(`Recipient updated - using amount: "${amount}" for tx data`);
              this.updateERC20TransferData(token.address, toAddress, amount, token.decimals);
              console.log(`After to update: txFormData.data = ${this.txFormData?.data}`);
            }
          } else if (field.id === 'tx-amount') {
            // Store the current value directly from the event
            const currentAmountValue = input.value;
            console.log(`Amount input changed to: "${currentAmountValue}" (using direct value from event)`);
            
            if (isEth) {
              // For ETH, use the value directly
              this.txFormData!.value = currentAmountValue;
            } else {
              // For ERC20, update the transfer data
              const toAddress = (document.getElementById('tx-to') as HTMLInputElement)?.value || '';
              console.log(`Amount changed: Updating ERC20 data with "${currentAmountValue}" (decimals: ${token.decimals})`);
              
              // Use the current value directly rather than re-reading from the DOM
              this.updateERC20TransferData(token.address, toAddress, currentAmountValue, token.decimals);
              console.log(`After amount update: txFormData.data = ${this.txFormData?.data}`);
            }
          }
        });

        // Add keydown event listener for : key
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
      }

      if (field.type !== 'combo') {
        form.appendChild(fieldContainer);
      } else {
        form.appendChild(fieldContainer);
      }
    });

    // Add detailed help text to explain the difference between ETH and ERC20 tokens
    const helperText = document.createElement('p');
    helperText.className = 'mt-6 text-sm text-gray-400';
    helperText.textContent = 'Fill in the recipient address and amount, then use :p command to propose the transaction.';
    
    // Add token-specific info
    const tokenInfoText = document.createElement('div');
    tokenInfoText.className = 'mt-4 text-sm text-gray-500 p-3 bg-gray-900 rounded-md';
    
    if (isEth) {
      tokenInfoText.innerHTML = `
        <p class="font-medium text-blue-400">Native ETH Transfer</p>
        <p class="mt-1">This will create a direct ETH transfer from your Safe to the recipient.</p>
      `;
    } else {
      tokenInfoText.innerHTML = `
        <p class="font-medium text-green-400">ERC20 Token Transfer</p>
        <p class="mt-1">This will call the <code class="bg-gray-800 px-1 rounded">transfer()</code> function on the ${token.symbol} token contract at address:</p>
        <p class="mt-1 font-mono text-xs break-all">${token.address}</p>
      `;
    }

    // Assemble the form
    formContainer.appendChild(title);
    formContainer.appendChild(subtitle);
    formContainer.appendChild(form);
    form.appendChild(helperText);
    form.appendChild(tokenInfoText);
    
    this.buffer.appendChild(formContainer);
    
    console.log(`Token sending screen set up for ${isEth ? 'ETH' : 'ERC20'} token: ${token.symbol}`);
  }
  
  /**
   * Helper method to update txFormData with ERC20 transfer function data
   */
  private updateERC20TransferData(tokenAddress: string, to: string, amount: string, decimals: number): void {
    console.log(`[DATA UPDATE] Updating ERC20 transfer data:`);
    console.log(`  - Token: ${tokenAddress}`);
    console.log(`  - To: ${to}`);
    console.log(`  - Amount (raw): "${amount}"`);
    console.log(`  - Decimals: ${decimals}`);
    
    if (!to) {
      console.log('Missing to address, cannot update ERC20 transfer data');
      return;
    }
    
    try {
      // Create ERC20 interface
      const erc20Interface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)"
      ]);
      
      // Parse the amount with the correct number of decimals
      let parsedAmount;
      
      // Properly sanitize the input amount
      const sanitizedAmount = amount.trim().replace(/,/g, '');
      console.log(`Sanitized amount: "${sanitizedAmount}"`);
      
      if (!sanitizedAmount || sanitizedAmount === '') {
        console.log('Empty amount, defaulting to zero');
        parsedAmount = 0n;
      } else {
        try {
          console.log(`Attempting to parse amount "${sanitizedAmount}" with ${decimals} decimals`);
          
          // Parse using ethers parseUnits with proper decimal precision for the token
          parsedAmount = ethers.parseUnits(sanitizedAmount, decimals);
          console.log(`Successfully parsed amount: ${parsedAmount.toString()}`);
          
          // Verify the parsed amount by formatting it back for debugging
          const formattedBack = ethers.formatUnits(parsedAmount, decimals);
          console.log(`Parsed amount formatted back: ${formattedBack}`);
        } catch (parseError) {
          console.error('Error parsing token amount:', parseError);
          
          // Try alternative parsing approaches
          if (sanitizedAmount.includes('.')) {
            // Handle decimal numbers
            try {
              // Extract parts before and after decimal
              const [wholePart, decimalPart = ''] = sanitizedAmount.split('.');
              console.log(`Trying alternative parsing: whole=${wholePart}, decimal=${decimalPart}`);
              
              // Construct a properly formatted decimal string
              const paddedDecimal = decimalPart.padEnd(decimals, '0').substring(0, decimals);
              const wholeNumber = wholePart === '' ? '0' : wholePart;
              console.log(`Padded decimal: ${wholeNumber}.${paddedDecimal}`);
              
              // Try parsing again with the properly formatted number
              parsedAmount = ethers.parseUnits(`${wholeNumber}.${paddedDecimal}`, decimals);
              console.log(`Alternative parsing successful: ${parsedAmount.toString()}`);
            } catch (altError) {
              console.error('Alternative parsing also failed:', altError);
              // Let it be 0 after all attempts failed, but log error
              parsedAmount = 0n;
            }
          } else {
            // For integers (no decimal)
            try {
              // Try parsing as a whole number
              parsedAmount = BigInt(sanitizedAmount) * (10n ** BigInt(decimals));
              console.log(`Parsed as integer: ${parsedAmount.toString()}`);
            } catch (intError) {
              console.error('Integer parsing failed:', intError);
              parsedAmount = 0n;
            }
          }
        }
      }
      
      // Encode the transfer function call with the properly parsed amount
      const data = erc20Interface.encodeFunctionData("transfer", [to, parsedAmount]);
      console.log(`Encoded ERC20 transfer data: ${data}`);
      
      // Update txFormData
      this.txFormData!.to = tokenAddress;
      this.txFormData!.value = "0"; 
      this.txFormData!.data = data;
      
      // Log the transaction data for debugging
      console.log('Final txFormData:', JSON.stringify(this.txFormData));
    } catch (error) {
      console.error('Error encoding ERC20 transfer:', error);
    }
  }
}

export default VimApp;
