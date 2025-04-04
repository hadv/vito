import { BlockchainTransaction } from '@/types';
import { ethers } from 'ethers';

/**
 * Helper function to truncate address for display
 */
const truncateAddress = (address: string): string => {
  if (!address || address.length < 10) return address || '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

/**
 * Helper function to format token value based on decimals
 */
const formatTokenValue = (value: string, decimals: number): string => {
  try {
    // Convert from wei/token base units to token amount
    const formatted = ethers.formatUnits(value, decimals);
    // Remove trailing zeros
    return formatted.replace(/\.?0+$/, '');
  } catch (error) {
    console.warn('Error formatting token value:', error);
    return value;
  }
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
  private selectedRowIndex = 0; // Keep track of the currently selected row
  private transactions: BlockchainTransaction[] = []; // Store transactions for keyboard navigation
  private keyboardListener: ((e: KeyboardEvent) => void) | null = null; // Store keyboard event listener
  private onTransactionSelectCallback: ((tx: BlockchainTransaction) => void) | null = null; // Callback for transaction selection
  private onBackClickCallback: (() => void) | null = null; // Callback for back button
  private isDetailsView = false; // Whether we're in the details view or list view
  // Flag to prevent multiple renders when returning from details
  private isReturningFromDetails = false;
  // Store callbacks for different navigation paths
  private goToWalletInfoCallback: (() => void) | null = null; // Callback to return to wallet info screen

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
   */
  public async render(
    onBackClick: () => void,
    onTransactionSelect: (tx: BlockchainTransaction) => void
  ): Promise<void> {
    // This is the callback to go back to wallet info screen
    // Store it separately from the transaction list navigation
    this.goToWalletInfoCallback = onBackClick;

    // Store callbacks if they are valid (not null)
    if (onTransactionSelect) {
      this.onTransactionSelectCallback = onTransactionSelect;
    }

    // If we're not returning from details, set up normal navigation
    if (!this.isReturningFromDetails) {
      this.onBackClickCallback = onBackClick;
    } else {
      // We're returning from details, just reset the flag
      this.isReturningFromDetails = false;
    }

    this.isDetailsView = false;

    // Remove any existing keyboard listener
    this.removeKeyboardListener();

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

      // Store transactions for keyboard navigation
      this.transactions = transactions;
      this.selectedRowIndex = 0; // Reset selection when loading transactions

      // Remove loading indicator
      container.removeChild(loadingIndicator);

      if (transactions.length === 0) {
        // If we're on a page > 0 and there are no transactions, go back to previous page
        if (this.transactionPage > 0) {
          this.transactionPage--;
          // Re-render with the previous page
          await this.render(this.goToWalletInfoCallback!, this.onTransactionSelectCallback!);
          return;
        }

        const noTxMessage = document.createElement('div');
        noTxMessage.className = 'text-center py-8 text-gray-500 bg-gray-800 rounded-lg border border-gray-700 shadow-lg p-6';
        noTxMessage.textContent = 'No blockchain transactions found for this Safe wallet address';
        container.appendChild(noTxMessage);

        return;
      }

      // Create transactions table
      const table = document.createElement('table');
      table.className = 'min-w-full bg-gray-800 rounded-lg border border-gray-700 shadow-lg overflow-hidden';
      table.id = 'transaction-table';

      // Create table header
      const thead = document.createElement('thead');
      thead.className = 'bg-gray-900 border-b border-gray-700';
      thead.innerHTML = `
        <tr>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">Date</th>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">Hash</th>
          <th class="py-3 px-4 text-left text-xs font-medium text-gray-400">State Changes</th>
        </tr>
      `;
      table.appendChild(thead);

      // Create table body
      const tbody = document.createElement('tbody');

      transactions.forEach((tx: BlockchainTransaction, index: number) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50';
        tr.classList.add('hover:bg-gray-700/50', 'cursor-pointer', 'border-b', 'border-gray-700');
        // Make each row focusable
        tr.tabIndex = 0;
        tr.dataset.index = index.toString();
        tr.dataset.txHash = tx.txHash || tx.safeTxHash;

        // Format date
        const date = new Date(tx.timestamp * 1000);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

        // Get etherscan URL
        const txHash = tx.executedTxHash || tx.txHash || tx.safeTxHash;
        const etherscanUrl = this.getEtherscanUrl(this.selectedNetwork.chainId, txHash);

        // Generate state changes content
        let stateChangesHTML = '';

        if (tx.stateChanges && tx.stateChanges.length > 0) {
          // Filter state changes to only show those related to safe wallet
          // AND filter out 0 value ETH transactions (for multisig executions)
          const relevantChanges = tx.stateChanges.filter(change =>
            (change.from.toLowerCase() === this.safeAddress.toLowerCase() ||
             change.to.toLowerCase() === this.safeAddress.toLowerCase()) &&
            // Filter out native currency (ETH) transactions with 0 value
            !(change.tokenAddress === '0x0000000000000000000000000000000000000000' &&
              (change.value === '0' || change.value === '0x0' || parseInt(change.value, 16) === 0))
          );

          if (relevantChanges.length === 0) {
            stateChangesHTML = '<span class="text-gray-500">No relevant state changes</span>';
          } else {
            stateChangesHTML = relevantChanges.map(change => {
              const isOutgoing = change.from.toLowerCase() === this.safeAddress.toLowerCase();
              const directionClass = isOutgoing ? 'text-red-400' : 'text-green-400';
              const formattedValue = formatTokenValue(change.value, change.tokenDecimals);

              return `
                <div class="flex items-center py-1 ${directionClass}">
                  ${isOutgoing ?
                    '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"></path></svg>' :
                    '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6"></path></svg>'
                  }
                  ${formattedValue} ${change.tokenSymbol}
                  ${isOutgoing ?
                    `<span class="text-xs ml-1">to ${truncateAddress(change.to)}</span>` :
                    `<span class="text-xs ml-1">from ${truncateAddress(change.from)}</span>`
                  }
                </div>
              `;
            }).join('');
          }
        } else {
          stateChangesHTML = '<span class="text-gray-500">No state changes</span>';
        }

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
          <td class="py-3 px-4 text-sm">${stateChangesHTML}</td>
        `;

        // Set up the transaction row click event with the right page tracking
        this.setupTransactionRowClick(tx, index, tr);

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
          // Use consistent callbacks
          await this.render(this.goToWalletInfoCallback!, this.onTransactionSelectCallback!);
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
          // Use consistent callbacks
          await this.render(this.goToWalletInfoCallback!, this.onTransactionSelectCallback!);
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

      // Add keyboard navigation instructions
      const keyboardHelp = document.createElement('div');
      keyboardHelp.className = 'text-center text-gray-500 text-xs mt-4';
      keyboardHelp.innerHTML = `
        <div class="mb-2">Keyboard navigation:</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div><kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">↑</kbd> / <kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">↓</kbd> Navigate transactions</div>
          <div><kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Enter</kbd> View details</div>
          <div><kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Esc</kbd> Back to list</div>
          <div><kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">←</kbd> / <kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">→</kbd> Change page</div>
        </div>
      `;
      container.appendChild(keyboardHelp);

      // Setup keyboard navigation
      this.setupKeyboardNavigation();

      // Highlight the first row if there are transactions
      if (transactions.length > 0) {
        this.highlightRow(this.selectedRowIndex);

        // Focus the first transaction row
        setTimeout(() => {
          const firstRow = document.querySelector('#transaction-table tbody tr[data-index="0"]') as HTMLElement;
          if (firstRow) {
            firstRow.focus();
          }
        }, 100);
      }

    } catch (error) {
      console.error('Error loading transactions:', error);
      if (loadingIndicator.parentNode) {
        loadingIndicator.textContent = 'Error loading transactions. Please try again.';
        loadingIndicator.className = 'my-8 text-center text-red-500';
      }
    }
  }

  /**
   * Shows the transaction details screen for a specific transaction
   */
  public showTransactionDetails(
    tx: BlockchainTransaction,
    onExecuteTransaction?: (txHash: string) => void
  ): void {
    // Save the current page number before showing details
    const pageBeforeDetails = this.transactionPage;

    // Create a simplified back handler that preserves the page
    this.onBackClickCallback = () => {
      // Set the flag to prevent page reset in render() method
      this.isReturningFromDetails = true;

      // Reset page to what it was before viewing details
      this.transactionPage = pageBeforeDetails;

      // If we're on an empty page, go back to the previous page
      if (this.transactions.length === 0 && this.transactionPage > 0) {
        this.transactionPage--;
      }

      // Just directly render the list view instead of calling onBackClick
      // This avoids the double-render issue
      if (this.goToWalletInfoCallback && this.onTransactionSelectCallback) {
        this.render(this.goToWalletInfoCallback, this.onTransactionSelectCallback);
      }
    };

    this.isDetailsView = true;

    // Remove existing keyboard listener and setup a new one for details view
    this.removeKeyboardListener();

    // Setup keyboard listener for details view - with Escape key to go back
    this.keyboardListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.onBackClickCallback) {
        e.preventDefault();
        this.onBackClickCallback();
      }
    };
    document.addEventListener('keydown', this.keyboardListener, true);

    // Clear the buffer
    this.buffer.innerHTML = '';

    // Create container
    const container = document.createElement('div');
    container.className = 'max-w-4xl mx-auto';
    container.tabIndex = -1;

    // Add back button
    const backButton = document.createElement('button');
    backButton.className = 'mb-4 text-blue-400 hover:text-blue-300 flex items-center';
    backButton.innerHTML = `
      <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
      </svg>
      Back to Transactions
    `;
    backButton.addEventListener('click', this.onBackClickCallback);
    container.appendChild(backButton);

    // Create details container
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'bg-gray-800 rounded-lg border border-gray-700 shadow-lg p-6 mb-6';

    // Display transaction info
    const title = document.createElement('h3');
    title.className = 'text-lg font-medium text-gray-300 mb-6';
    title.textContent = `Transaction Details (${tx.dataDecoded?.method || 'Unknown'})`;
    detailsContainer.appendChild(title);

    // Create transaction info grid
    const infoGrid = document.createElement('div');
    infoGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-6';

    const fromAddress = tx.from || (tx.stateChanges && tx.stateChanges.length > 0 ? tx.stateChanges[0].from : 'Unknown');

    // Add transaction details
    this.addDetailRow(infoGrid, 'Transaction Hash', tx.txHash, true);
    if (tx.executedTxHash && tx.executedTxHash !== tx.txHash) {
      this.addDetailRow(infoGrid, 'Executed Hash', tx.executedTxHash, true);
    }

    const date = new Date(tx.timestamp * 1000);
    this.addDetailRow(infoGrid, 'Date', date.toLocaleString());
    this.addDetailRow(infoGrid, 'From', fromAddress, true);
    this.addDetailRow(infoGrid, 'To', tx.to, true);

    if (tx.tokenInfo) {
      this.addDetailRow(infoGrid, 'Token', tx.tokenInfo.name);
      this.addDetailRow(infoGrid, 'Token Symbol', tx.tokenInfo.symbol);
      this.addDetailRow(infoGrid, 'Token Contract', tx.tokenInfo.address, true);
    }

    const formattedValue = tx.tokenInfo ?
      `${formatTokenValue(tx.value, tx.tokenInfo.decimals)} ${tx.tokenInfo.symbol}` :
      `${ethers.formatEther(tx.value)} ${this.getNativeTokenSymbol()}`;
    this.addDetailRow(infoGrid, 'Value', formattedValue);

    // Add state changes section
    if (tx.stateChanges && tx.stateChanges.length > 0) {
      // Add state changes title
      const stateChangesTitle = document.createElement('h4');
      stateChangesTitle.className = 'text-md font-medium text-gray-300 mt-6 mb-3 col-span-2';
      stateChangesTitle.textContent = 'State Changes';
      infoGrid.appendChild(stateChangesTitle);

      // Show all state changes relevant to the safe wallet
      // AND filter out 0 value ETH transactions (for multisig executions)
      const relevantChanges = tx.stateChanges.filter(change =>
        (change.from.toLowerCase() === this.safeAddress.toLowerCase() ||
         change.to.toLowerCase() === this.safeAddress.toLowerCase()) &&
        // Filter out native currency (ETH) transactions with 0 value
        !(change.tokenAddress === '0x0000000000000000000000000000000000000000' &&
          (change.value === '0' || change.value === '0x0' || parseInt(change.value, 16) === 0))
      );

      if (relevantChanges.length === 0) {
        const noChanges = document.createElement('div');
        noChanges.className = 'text-gray-500 col-span-2';
        noChanges.textContent = 'No relevant state changes for this wallet';
        infoGrid.appendChild(noChanges);
        } else {
        const stateChangesContainer = document.createElement('div');
        stateChangesContainer.className = 'col-span-2 space-y-2';

        relevantChanges.forEach(change => {
          const isOutgoing = change.from.toLowerCase() === this.safeAddress.toLowerCase();
          const directionClass = isOutgoing ? 'text-red-400' : 'text-green-400';
          const formattedValue = formatTokenValue(change.value, change.tokenDecimals);

          const changeRow = document.createElement('div');
          changeRow.className = `flex items-center justify-between p-2 rounded bg-gray-700/50 ${directionClass}`;
          changeRow.innerHTML = `
            <div class="flex items-center">
              ${isOutgoing ?
                '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"></path></svg>' :
                '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6"></path></svg>'
              }
              ${isOutgoing ? 'Sent to ' : 'Received from '}
              <span class="font-mono mx-1">${truncateAddress(isOutgoing ? change.to : change.from)}</span>
            </div>
            <div class="font-medium">${formattedValue} ${change.tokenSymbol}</div>
          `;

          stateChangesContainer.appendChild(changeRow);
        });

        infoGrid.appendChild(stateChangesContainer);
      }
    }

    detailsContainer.appendChild(infoGrid);

    // Add transaction data section if available
    if (tx.data && tx.data !== '0x') {
      const dataContainer = document.createElement('div');
      dataContainer.className = 'mt-6';

      const dataTitle = document.createElement('h4');
      dataTitle.className = 'text-md font-medium text-gray-300 mb-2';
      dataTitle.textContent = 'Transaction Data';
      dataContainer.appendChild(dataTitle);

      const dataValue = document.createElement('div');
      dataValue.className = 'font-mono text-xs bg-gray-900 p-3 rounded-lg overflow-x-auto';

      // Truncate data if it's too long
      const displayData = tx.data.length > 200 ? tx.data.substring(0, 200) + '...' : tx.data;
      dataValue.textContent = displayData;

      // Add copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center';
      copyBtn.innerHTML = `
        <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
        </svg>
        Copy Full Data
      `;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(tx.data);

        // Show feedback
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = 'Copied!';
        copyBtn.disabled = true;

        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.disabled = false;
        }, 2000);
      });

      dataContainer.appendChild(dataValue);
      dataContainer.appendChild(copyBtn);

      detailsContainer.appendChild(dataContainer);
    }

    container.appendChild(detailsContainer);

    // Add transaction execution section for future transactions
    if (!tx.isExecuted && tx.safeTxHash && onExecuteTransaction) {
      const executionContainer = document.createElement('div');
      executionContainer.className = 'bg-gray-800 rounded-lg border border-gray-700 shadow-lg p-6';

      const executionTitle = document.createElement('h3');
      executionTitle.className = 'text-lg font-medium text-gray-300 mb-4';
      executionTitle.textContent = 'Execute Transaction';
      executionContainer.appendChild(executionTitle);

      const executionDescription = document.createElement('p');
      executionDescription.className = 'text-sm text-gray-400 mb-4';
      executionDescription.textContent = 'This transaction has not been executed yet. Click the button below to execute it.';
      executionContainer.appendChild(executionDescription);

      const executeButton = document.createElement('button');
      executeButton.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors';
      executeButton.textContent = 'Execute Transaction';
      executeButton.addEventListener('click', () => {
        onExecuteTransaction(tx.safeTxHash);
      });
      executionContainer.appendChild(executeButton);

      container.appendChild(executionContainer);
    }

    // Add keyboard help text
    const keyboardHelp = document.createElement('div');
    keyboardHelp.className = 'text-center text-gray-500 text-xs mt-4';
    keyboardHelp.innerHTML = `
      <div class="mb-2">Keyboard navigation:</div>
      <div><kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Esc</kbd> Back to transaction list</div>
    `;
    container.appendChild(keyboardHelp);

    // Add container to buffer
    this.buffer.appendChild(container);
  }

  /**
   * Helper method to add a detail row to the transaction details
   */
  private addDetailRow(
    container: HTMLElement,
    label: string,
    value: string,
    isCopyable: boolean = false
  ): void {
    const detail = document.createElement('div');

      const labelEl = document.createElement('div');
      labelEl.className = 'text-sm font-medium text-gray-500';
      labelEl.textContent = label;
      detail.appendChild(labelEl);

      const valueContainer = document.createElement('div');
      valueContainer.className = 'flex items-center mt-1';

      const valueEl = document.createElement('div');
      valueEl.className = 'text-sm text-gray-300';
    if (label === 'Transaction Hash' || label === 'Executed Hash' || label === 'From' || label === 'To' || label === 'Token Contract') {
        valueEl.className += ' font-mono';
      }

        valueEl.textContent = value;
      valueContainer.appendChild(valueEl);

      if (isCopyable) {
        const copyButton = document.createElement('button');
        copyButton.className = 'ml-2 text-gray-500 hover:text-blue-400';
      copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>';
        copyButton.title = 'Copy to clipboard';
        copyButton.addEventListener('click', () => {
          navigator.clipboard.writeText(value).then(() => {
            copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => {
            copyButton.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>';
            }, 2000);
          });
        });
        valueContainer.appendChild(copyButton);
      }

      detail.appendChild(valueContainer);
    container.appendChild(detail);
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

  /**
   * Get the native token symbol for the current network
   */
  private getNativeTokenSymbol(): string {
    const symbolMap: Record<number, string> = {
      1: 'ETH',      // Ethereum
      5: 'GoerliETH', // Goerli
      11155111: 'SepETH', // Sepolia
      137: 'MATIC',  // Polygon
      80001: 'MATIC', // Mumbai
      10: 'ETH',     // Optimism
      8453: 'ETH',   // Base
      100: 'xDAI',   // Gnosis
    };
    return symbolMap[this.selectedNetwork.chainId] || 'ETH';
  }

  /**
   * Setup keyboard navigation for transaction list and details
   */
  private setupKeyboardNavigation(): void {
    // Remove any existing keyboard listener first
    this.removeKeyboardListener();

    // Create keyboard event listener for global navigation
    this.keyboardListener = (e: KeyboardEvent) => {
      // Different behavior based on whether we're in list or details view
      if (this.isDetailsView) {
        // Details view keyboard navigation
        if (e.key === 'Escape' && this.onBackClickCallback) {
          e.preventDefault();
          this.onBackClickCallback();
        }
      } else {
        // List view keyboard navigation
        switch (e.key) {
          case 'ArrowUp':
          case 'k': // vim-style up
            e.preventDefault();
            if (this.selectedRowIndex > 0) {
              this.selectedRowIndex--;
              this.highlightRow(this.selectedRowIndex);
            }
            break;

          case 'ArrowDown':
          case 'j': // vim-style down
            e.preventDefault();
            if (this.selectedRowIndex < this.transactions.length - 1) {
              this.selectedRowIndex++;
              this.highlightRow(this.selectedRowIndex);
            }
            break;

          case 'Enter':
            e.preventDefault();
            if (this.transactions.length > 0 && this.onTransactionSelectCallback) {
              // When a transaction is selected, store the current page
              const currentTx = this.transactions[this.selectedRowIndex];
              if (currentTx) {
                this.onTransactionSelectCallback(currentTx);
              }
            }
            break;

          case 'ArrowLeft':
          case 'h': // vim-style left
            e.preventDefault();
            if (this.transactionPage > 0) {
              this.transactionPage--;
              if (this.goToWalletInfoCallback && this.onTransactionSelectCallback) {
                this.render(this.goToWalletInfoCallback, this.onTransactionSelectCallback);
              }
            }
            break;

          case 'ArrowRight':
          case 'l': // vim-style right
            e.preventDefault();
            if (this.transactions.length >= this.transactionsPerPage) {
              this.transactionPage++;
              if (this.goToWalletInfoCallback && this.onTransactionSelectCallback) {
                this.render(this.goToWalletInfoCallback, this.onTransactionSelectCallback);
              }
            }
            break;
        }
      }
    };

    // Add the keyboard event listener with capture phase
    document.addEventListener('keydown', this.keyboardListener, true);
  }

  /**
   * Remove keyboard event listener
   */
  private removeKeyboardListener(): void {
    if (this.keyboardListener) {
      // Make sure to remove with the same capture phase parameter
      document.removeEventListener('keydown', this.keyboardListener, true);
      this.keyboardListener = null;
    }
  }

  /**
   * Highlight a specific row in the transaction table
   */
  private highlightRow(index: number): void {
    // Remove highlight from all rows
    const allRows = document.querySelectorAll('#transaction-table tbody tr');
    allRows.forEach(row => {
      row.classList.remove('bg-gray-600'); // Removed darker background
      row.classList.remove('bg-blue-900/30'); // Removed blue tint
      row.classList.remove('border-blue-500');
      row.classList.remove('border-l-4');
      // Reset the even/odd row coloring
      const rowIndex = parseInt(row.getAttribute('data-index') || '0', 10);
      row.className = rowIndex % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50';
      row.classList.add('hover:bg-gray-700/50', 'cursor-pointer', 'border-b', 'border-gray-700');
    });

    // Add highlight to the selected row with a lighter color
    const selectedRow = document.querySelector(`#transaction-table tbody tr[data-index="${index}"]`) as HTMLElement;
    if (selectedRow) {
      selectedRow.classList.add('bg-blue-900/30'); // Light blue highlight
      selectedRow.classList.add('border-blue-500');
      selectedRow.classList.add('border-l-4');

      // Focus the row directly if it exists
      selectedRow.focus();

      // Scroll the row into view if needed
      selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /**
   * Clean up resources when component is destroyed
   */
  public destroy(): void {
    this.removeKeyboardListener();
  }

  // Set up the transaction row click event with the right page tracking
  private setupTransactionRowClick(tx: BlockchainTransaction, index: number, tr: HTMLElement): void {
    // Add click event listener
    tr.addEventListener('click', () => {
      this.selectedRowIndex = index;
      // Always use the transaction callback
      this.onTransactionSelectCallback!(tx);
    });

    // Also add keyboard event handlers to each row
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.selectedRowIndex = index;
        // Always use the transaction callback
        this.onTransactionSelectCallback!(tx);
      }
    });
  }
}