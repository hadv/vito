import { SafeInfo } from '../types/safe';
import { Token } from '../types/token';
import { ethers } from 'ethers';
import { PriceOracle } from '../services';
import { truncateAddress } from '../utils';

export class SafeInfoDisplay {
  private buffer: HTMLElement;
  private provider?: ethers.JsonRpcProvider;
  private safeAddress?: string;
  private signerAddress?: string;
  private selectedNetwork: any; // Using any for now, should be replaced with the correct type
  private cachedSafeInfo?: SafeInfo;
  private commandInput?: HTMLInputElement;
  private showTokenSendingScreen: (token: Token) => void;

  constructor(
    buffer: HTMLElement,
    provider: ethers.JsonRpcProvider | undefined,
    safeAddress: string | undefined,
    signerAddress: string | undefined,
    selectedNetwork: any,
    cachedSafeInfo: SafeInfo | undefined,
    commandInput: HTMLInputElement | undefined,
    showTokenSendingScreen: (token: Token) => void
  ) {
    this.buffer = buffer;
    this.provider = provider;
    this.safeAddress = safeAddress;
    this.signerAddress = signerAddress;
    this.selectedNetwork = selectedNetwork;
    this.cachedSafeInfo = cachedSafeInfo;
    this.commandInput = commandInput;
    this.showTokenSendingScreen = showTokenSendingScreen;
  }

  public display(safeInfo: SafeInfo): void {
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
  
  // Method to fetch and display token balances
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
      const self = this; // Reference to this instance
      
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
        rows.forEach((row) => {
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
} 