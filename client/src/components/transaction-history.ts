import { BlockchainTransaction } from '../types';
import { ethers } from 'ethers';

/**
 * Helper function to truncate address for display
 */
const truncateAddress = (address: string): string => {
  if (!address || address.length < 10) return address || '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

/**
 * TransactionHistory component for displaying a list of blockchain transactions
 */
export class TransactionHistory {
  private buffer: HTMLDivElement;
  private transactionPage = 0;
  private transactionsPerPage = 10;
  private selectedNetwork: { chainId: number; blockExplorer?: string };
  private safeAddress: string;
  private transactionService: any; // Will be properly typed in constructor

  /**
   * Creates a new TransactionHistory component
   * @param buffer The HTML element to render the component in
   * @param safeAddress The Safe wallet address
   * @param selectedNetwork The selected network configuration
   * @param transactionService The transaction service to use for fetching transactions
   */
  constructor(
    buffer: HTMLDivElement, 
    safeAddress: string,
    selectedNetwork: { chainId: number; blockExplorer?: string },
    transactionService: any
  ) {
    this.buffer = buffer;
    this.safeAddress = safeAddress;
    this.selectedNetwork = selectedNetwork;
    this.transactionService = transactionService;
  }

  /**
   * Gets the etherscan URL for a transaction hash
   * @param chainId The chain ID
   * @param hash The transaction hash
   * @param isTx Whether the hash is a transaction (true) or address (false)
   * @returns The etherscan URL
   */
  private getEtherscanUrl(chainId: number, hash: string, isTx: boolean = true): string {
    // Map of chain IDs to Etherscan URLs
    const etherscanUrls: Record<number, string> = {
      1: 'https://etherscan.io',
      5: 'https://goerli.etherscan.io',
      11155111: 'https://sepolia.etherscan.io',
      137: 'https://polygonscan.com',
      80001: 'https://mumbai.polygonscan.com',
      8453: 'https://basescan.org',
      100: 'https://gnosisscan.io',
      10: 'https://optimistic.etherscan.io',
    };
    
    const baseUrl = etherscanUrls[chainId] || this.selectedNetwork.blockExplorer;
    if (!baseUrl) return '#';
    
    return `${baseUrl}/${isTx ? 'tx' : 'address'}/${hash}`;
  }

  /**
   * Renders the transaction history screen
   * @param onBackClick Callback for when the back button is clicked
   * @param onTransactionSelect Callback for when a transaction is selected
   * @returns Promise that resolves when the rendering is complete
   */
  public async render(
    onBackClick: () => void,
    onTransactionSelect: (tx: BlockchainTransaction) => void
  ): Promise<void> {
    if (!this.safeAddress) {
      const errorMsg = document.createElement('div');
      errorMsg.className = 'error-message p-4 text-red-500';
      errorMsg.textContent = 'No Safe wallet connected. Please connect a wallet first with :c <address>';
      this.buffer.innerHTML = '';
      this.buffer.appendChild(errorMsg);
      return;
    }

    // Clear the buffer
    this.buffer.innerHTML = '';
    
    // Create container for the transaction history
    const container = document.createElement('div');
    container.className = 'max-w-4xl mx-auto';
    container.tabIndex = -1;

    // Create title
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold mb-4 text-gray-300';
    title.textContent = 'Blockchain Transactions';
    container.appendChild(title);

    // Create description
    const description = document.createElement('p');
    description.className = 'text-sm text-gray-400 mb-6';
    description.textContent = 'Showing all blockchain transactions related to this Safe wallet address.';
    container.appendChild(description);

    // Create loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'my-8 text-center text-gray-500';
    loadingIndicator.textContent = 'Loading transactions...';
    container.appendChild(loadingIndicator);

    // Add container to buffer
    this.buffer.appendChild(container);

    try {
      // Get chain ID from selected network
      const chainId = this.selectedNetwork.chainId;
      
      // Fetch transactions
      const transactions = await this.transactionService.getSafeTransactions(
        this.safeAddress,
        chainId,
        this.transactionsPerPage,
        this.transactionPage * this.transactionsPerPage
      );

      // Remove loading indicator
      container.removeChild(loadingIndicator);

      if (transactions.length === 0) {
        const noTxMessage = document.createElement('div');
        noTxMessage.className = 'text-center py-8 text-gray-500 bg-gray-800 rounded-lg border border-gray-700 shadow-lg p-6';
        noTxMessage.textContent = 'No blockchain transactions found for this Safe wallet address';
        container.appendChild(noTxMessage);
        return;
      }

      // Create transactions table
      const table = document.createElement('table');
      table.className = 'min-w-full bg-gray-800 rounded-lg border border-gray-700 shadow-lg overflow-hidden';
      
      // Create table header
      const thead = document.createElement('thead');
      thead.className = 'bg-gray-900 border-b border-gray-700';
      thead.innerHTML = `
        <tr>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">Date</th>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">Hash</th>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">Direction</th>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">To</th>
          <th class="py-3 px-4 text-right text-xs font-medium text-gray-400">Value</th>
        </tr>
      `;
      table.appendChild(thead);
      
      // Create table body
      const tbody = document.createElement('tbody');
      
      transactions.forEach((tx: BlockchainTransaction, index: number) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50';
        tr.classList.add('hover:bg-gray-700/50', 'cursor-pointer', 'border-b', 'border-gray-700');
        tr.dataset.txHash = tx.txHash || tx.safeTxHash;
        
        // Format date
        const date = new Date(tx.timestamp * 1000);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        // Format value
        let formattedValue = '0 ETH';
        if (tx.value && tx.value !== '0') {
          try {
            // Try to format the value as wei
            formattedValue = ethers.formatEther(tx.value) + ' ETH';
          } catch (error) {
            // If formatting fails, the value might already be in ETH format
            // Just use the value directly if it's a decimal string
            if (typeof tx.value === 'string' && tx.value.includes('.')) {
              formattedValue = tx.value + ' ETH';
            } else {
              console.warn('Invalid transaction value format:', tx.value);
              formattedValue = '? ETH';
            }
          }
        }
        
        // Determine transaction direction
        const isOutgoing = tx.dataDecoded?.method === 'Outgoing Transaction';
        const directionClass = isOutgoing ? 'text-red-400' : 'text-green-400';
        const directionIcon = isOutgoing 
          ? '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"></path></svg>'
          : '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6"></path></svg>';
        const direction = isOutgoing ? 'Outgoing' : 'Incoming';
        
        // Use executedTxHash if available, otherwise fallback to txHash, then safeTxHash
        const txHash = tx.executedTxHash || tx.txHash || tx.safeTxHash;
        const etherscanUrl = this.getEtherscanUrl(this.selectedNetwork.chainId, txHash);
        
        tr.innerHTML = `
          <td class="py-3 px-4 text-sm text-gray-300">${formattedDate}</td>
          <td class="py-3 px-4 text-sm font-mono">
            <a href="${etherscanUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300" onclick="event.stopPropagation();">
              ${truncateAddress(txHash)}
              <svg class="inline-block w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
              </svg>
            </a>
          </td>
          <td class="py-3 px-4 text-sm ${directionClass} flex items-center">${directionIcon}${direction}</td>
          <td class="py-3 px-4 text-sm font-mono text-gray-300">${truncateAddress(tx.to)}</td>
          <td class="py-3 px-4 text-sm text-right text-gray-300">${formattedValue}</td>
        `;
        
        // Add click event listener to show transaction details
        tr.addEventListener('click', () => {
          onTransactionSelect(tx);
        });
        
        tbody.appendChild(tr);
      });
      
      table.appendChild(tbody);
      container.appendChild(table);
      
      // Create pagination controls
      const paginationContainer = document.createElement('div');
      paginationContainer.className = 'flex justify-between items-center mt-4 text-sm';
      
      const prevButton = document.createElement('button');
      prevButton.className = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors';
      prevButton.textContent = 'Previous';
      prevButton.disabled = this.transactionPage === 0;
      if (prevButton.disabled) {
        prevButton.classList.add('opacity-50', 'cursor-not-allowed');
      }
      prevButton.addEventListener('click', async () => {
        if (this.transactionPage > 0) {
          this.transactionPage--;
          await this.render(onBackClick, onTransactionSelect);
        }
      });
      
      const pageInfo = document.createElement('span');
      pageInfo.className = 'text-gray-400';
      pageInfo.textContent = `Page ${this.transactionPage + 1}`;
      
      const nextButton = document.createElement('button');
      nextButton.className = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors';
      nextButton.textContent = 'Next';
      nextButton.disabled = transactions.length < this.transactionsPerPage;
      if (nextButton.disabled) {
        nextButton.classList.add('opacity-50', 'cursor-not-allowed');
      }
      nextButton.addEventListener('click', async () => {
        if (transactions.length >= this.transactionsPerPage) {
          this.transactionPage++;
          await this.render(onBackClick, onTransactionSelect);
        } else {
          // Show notification that there are no more transactions
          const notification = document.createElement('div');
          notification.className = 'fixed top-4 right-4 bg-gray-800 text-gray-300 px-4 py-2 rounded shadow-lg border border-gray-700';
          notification.textContent = 'No more transactions available';
          document.body.appendChild(notification);
          setTimeout(() => {
            document.body.removeChild(notification);
          }, 3000);
        }
      });
      
      paginationContainer.appendChild(prevButton);
      paginationContainer.appendChild(pageInfo);
      paginationContainer.appendChild(nextButton);
      container.appendChild(paginationContainer);
      
      // Add helpful instruction text
      const helpText = document.createElement('p');
      helpText.className = 'text-center text-gray-500 text-xs mt-4';
      helpText.textContent = 'Click on a transaction to view details';
      container.appendChild(helpText);
      
      // Add back button
      const backButton = document.createElement('button');
      backButton.className = 'mt-6 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors';
      backButton.textContent = 'Back to Safe Info';
      backButton.addEventListener('click', () => {
        onBackClick();
      });
      container.appendChild(backButton);
      
    } catch (error) {
      console.error('Error loading transactions:', error);
      if (loadingIndicator.parentNode) {
        loadingIndicator.textContent = 'Error loading transactions. Please try again.';
        loadingIndicator.className = 'my-8 text-center text-red-500';
      }
    }
  }

  /**
   * Renders detailed information about a specific transaction
   * @param tx The transaction to show details for
   * @param onBackClick Callback for when the back button is clicked
   * @param onExecuteTransaction Callback for when the execute transaction button is clicked
   */
  public showTransactionDetails(
    tx: BlockchainTransaction, 
    onBackClick: () => void,
    onExecuteTransaction?: (txHash: string) => void
  ): void {
    // Clear the buffer
    this.buffer.innerHTML = '';
    
    // Create container for the transaction details
    const container = document.createElement('div');
    container.className = 'max-w-4xl mx-auto';
    
    // Create back button
    const backButton = document.createElement('button');
    backButton.className = 'mb-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center';
    backButton.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> Back to Transactions';
    backButton.addEventListener('click', () => {
      onBackClick();
    });
    container.appendChild(backButton);
    
    // Determine if this is a blockchain transaction or a safe transaction
    const isBlockchainTx = tx.dataDecoded?.method === 'Incoming Transaction' || tx.dataDecoded?.method === 'Outgoing Transaction';
    
    // Create title with transaction type badge
    const titleContainer = document.createElement('div');
    titleContainer.className = 'flex items-center mb-4';
    
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold text-gray-300 mr-3';
    title.textContent = 'Transaction Details';
    titleContainer.appendChild(title);
    
    // Add transaction type badge
    const typeBadge = document.createElement('span');
    if (isBlockchainTx) {
      const isOutgoing = tx.dataDecoded?.method === 'Outgoing Transaction';
      typeBadge.className = `text-xs px-2 py-1 rounded ${isOutgoing ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`;
      typeBadge.textContent = isOutgoing ? 'Outgoing' : 'Incoming';
    } else {
      typeBadge.className = `text-xs px-2 py-1 rounded ${tx.isExecuted ? 'bg-blue-900 text-blue-300' : 'bg-yellow-900 text-yellow-300'}`;
      typeBadge.textContent = tx.isExecuted ? 'Executed Safe TX' : 'Pending Safe TX';
    }
    titleContainer.appendChild(typeBadge);
    
    container.appendChild(titleContainer);
    
    // Create details card
    const detailsCard = document.createElement('div');
    detailsCard.className = 'bg-gray-800 rounded-lg border border-gray-700 shadow-lg p-6 mb-6';
    
    // Format date
    const date = new Date(tx.timestamp * 1000);
    const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    
    // Format value
    let formattedValue = '0 ETH';
    if (tx.value && tx.value !== '0') {
      try {
        // Try to format the value as wei
        formattedValue = ethers.formatEther(tx.value) + ' ETH';
      } catch (error) {
        // If formatting fails, the value might already be in ETH format
        // Just use the value directly if it's a decimal string
        if (typeof tx.value === 'string' && tx.value.includes('.')) {
          formattedValue = tx.value + ' ETH';
        } else {
          console.warn('Invalid transaction value format:', tx.value);
          formattedValue = '? ETH';
        }
      }
    }

    // Create details grid
    const detailsGrid = document.createElement('div');
    detailsGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-4';
    
    // Helper function to create a detail row
    const createDetailRow = (label: string, value: string, isCopyable: boolean = false, isFullWidth: boolean = false) => {
      const detail = document.createElement('div');
      detail.className = isFullWidth ? 'col-span-1 md:col-span-2' : '';
      
      const labelEl = document.createElement('div');
      labelEl.className = 'text-sm font-medium text-gray-500';
      labelEl.textContent = label;
      detail.appendChild(labelEl);
      
      const valueContainer = document.createElement('div');
      valueContainer.className = 'flex items-center mt-1';
      
      const valueEl = document.createElement('div');
      valueEl.className = 'text-sm text-gray-300';
      if (label === 'Safe Transaction Hash' || label === 'Transaction Hash' || label === 'To' || label === 'From') {
        valueEl.className += ' font-mono';
      }
      
      if (label === 'Status' && !isBlockchainTx) {
        const status = tx.isExecuted ? 'Executed' : 'Pending';
        const statusClass = tx.isExecuted ? 'text-green-400' : 'text-yellow-400';
        valueEl.innerHTML = `<span class="${statusClass}">${status}</span>`;
      } else if (label === 'Direction') {
        const directionClass = value === 'Outgoing' ? 'text-red-400' : 'text-green-400';
        valueEl.innerHTML = `<span class="${directionClass}">${value}</span>`;
      } else {
        valueEl.textContent = value;
      }
      
      valueContainer.appendChild(valueEl);
      
      if (isCopyable) {
        const copyButton = document.createElement('button');
        copyButton.className = 'ml-2 text-gray-500 hover:text-blue-400';
        copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>';
        copyButton.title = 'Copy to clipboard';
        copyButton.addEventListener('click', () => {
          navigator.clipboard.writeText(value).then(() => {
            copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => {
              copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>';
            }, 2000);
          });
        });
        valueContainer.appendChild(copyButton);
      }
      
      detail.appendChild(valueContainer);
      return detail;
    };
    
    // Add transaction details
    detailsGrid.appendChild(createDetailRow('Safe Transaction Hash', tx.safeTxHash, true, true));
    detailsGrid.appendChild(createDetailRow('Date', formattedDate));
    detailsGrid.appendChild(createDetailRow('Status', tx.isExecuted ? 'Executed' : 'Pending'));
    detailsGrid.appendChild(createDetailRow('To', tx.to, true));
    if (tx.dataDecoded?.method) {
      detailsGrid.appendChild(createDetailRow('Method', tx.dataDecoded.method));
    }
    detailsGrid.appendChild(createDetailRow('Value', formattedValue));
    
    if (tx.executor) {
      detailsGrid.appendChild(createDetailRow('Executor', tx.executor, true));
    }
    
    detailsCard.appendChild(detailsGrid);
    
    // Add data section if the transaction has data
    if (tx.data && tx.data !== '0x') {
      const dataSection = document.createElement('div');
      dataSection.className = 'mt-6';
      
      const dataTitle = document.createElement('h3');
      dataTitle.className = 'text-md font-semibold mb-2 text-gray-400';
      dataTitle.textContent = 'Transaction Data';
      dataSection.appendChild(dataTitle);
      
      const dataContainer = document.createElement('div');
      dataContainer.className = 'bg-gray-900 p-4 rounded border border-gray-700 font-mono text-xs text-gray-300 overflow-x-auto';
      
      let formattedData = tx.data;
      // Try to make the data more readable if it's a method call
      if (tx.dataDecoded) {
        formattedData = JSON.stringify(tx.dataDecoded, null, 2);
      }
      
      dataContainer.textContent = formattedData;
      dataSection.appendChild(dataContainer);
      
      detailsCard.appendChild(dataSection);
    }
    
    // Add confirmations section if the transaction has confirmations
    if (!isBlockchainTx && tx.confirmations && tx.confirmations.length > 0) {
      const confirmationsSection = document.createElement('div');
      confirmationsSection.className = 'mt-6';
      
      const confirmationsTitle = document.createElement('h3');
      confirmationsTitle.className = 'text-md font-semibold mb-2 text-gray-400';
      confirmationsTitle.textContent = 'Confirmations';
      confirmationsSection.appendChild(confirmationsTitle);
      
      const confirmationsList = document.createElement('ul');
      confirmationsList.className = 'bg-gray-900 rounded border border-gray-700 divide-y divide-gray-700';
      
      tx.confirmations.forEach((confirmation: any) => {
        const item = document.createElement('li');
        item.className = 'p-3 flex justify-between';
        
        const signer = document.createElement('div');
        signer.className = 'text-sm font-mono text-gray-300';
        signer.textContent = truncateAddress(confirmation.owner);
        
        const date = new Date(confirmation.submissionDate);
        const confirmationDate = document.createElement('div');
        confirmationDate.className = 'text-sm text-gray-500';
        confirmationDate.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        item.appendChild(signer);
        item.appendChild(confirmationDate);
        confirmationsList.appendChild(item);
      });
      
      confirmationsSection.appendChild(confirmationsList);
      detailsCard.appendChild(confirmationsSection);
    }
    
    container.appendChild(detailsCard);
    
    // Add explorer link
    const explorerLinkContainer = document.createElement('div');
    explorerLinkContainer.className = 'text-center mb-6';
    
    const explorerLink = document.createElement('a');
    explorerLink.className = 'text-blue-400 hover:text-blue-300 text-sm flex items-center justify-center';
    explorerLink.innerHTML = '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg> View on Etherscan';
    
    // Prioritize the blockchain transaction hash (executedTxHash) for Etherscan links
    const explorerUrl = isBlockchainTx
      ? this.getEtherscanUrl(this.selectedNetwork.chainId, tx.executedTxHash || tx.txHash || tx.safeTxHash)
      : tx.executedTxHash
        ? this.getEtherscanUrl(this.selectedNetwork.chainId, tx.executedTxHash)
        : tx.txHash
          ? this.getEtherscanUrl(this.selectedNetwork.chainId, tx.txHash)
          : `https://app.safe.global/transactions/tx?safe=${this.safeAddress}&id=${tx.safeTxHash}`;
        
    // Ensure the URL is valid and has the correct structure
    try {
      // Test if URL is valid by constructing a URL object
      new URL(explorerUrl);
      explorerLink.href = explorerUrl;
    } catch (error) {
      console.warn('Invalid explorer URL:', explorerUrl);
      // Fallback to a safe default
      explorerLink.href = this.getEtherscanUrl(this.selectedNetwork.chainId, this.safeAddress || '', false) || 'https://etherscan.io';
    }
    
    explorerLink.target = '_blank';
    explorerLink.rel = 'noopener noreferrer';
    
    explorerLinkContainer.appendChild(explorerLink);
    container.appendChild(explorerLinkContainer);
    
    // Add execute button if the transaction is a pending Safe transaction
    if (!isBlockchainTx && !tx.isExecuted && onExecuteTransaction) {
      const executeButton = document.createElement('button');
      executeButton.className = 'w-full mt-4 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors';
      executeButton.textContent = 'Execute Transaction';
      executeButton.addEventListener('click', () => {
        if (onExecuteTransaction) {
          onExecuteTransaction(tx.safeTxHash);
        }
      });
      
      container.appendChild(executeButton);
    }
    
    this.buffer.appendChild(container);
  }

  /**
   * Sets the current page of transactions
   * @param page The page number (0-based)
   */
  public setPage(page: number): void {
    this.transactionPage = page;
  }

  /**
   * Gets the current page of transactions
   * @returns The current page number (0-based)
   */
  public getPage(): number {
    return this.transactionPage;
  }
} 