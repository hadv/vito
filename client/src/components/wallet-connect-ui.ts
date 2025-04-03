import { WalletConnectService } from '../services/wallet-connect';

/**
 * WalletConnectUI component to handle wallet connect session UI
 */
export class WalletConnectUI {
  private buffer: HTMLDivElement;
  private walletConnectService: WalletConnectService;

  /**
   * Creates a new WalletConnectUI component
   * @param buffer The HTML element to render the component in
   * @param walletConnectService The WalletConnect service
   */
  constructor(buffer: HTMLDivElement, walletConnectService: WalletConnectService) {
    this.buffer = buffer;
    this.walletConnectService = walletConnectService;
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners for WalletConnect events
   */
  private setupEventListeners(): void {
    // Handle session connection
    this.walletConnectService.addEventListener('session_connected', (data: any) => {
      this.showSuccessMessage(data.message || 'Wallet connected successfully!');
    });
    
    // Handle session disconnection
    this.walletConnectService.addEventListener('session_disconnected', () => {
      this.showInfoMessage('Wallet disconnected');
    });
    
    // Handle session errors
    this.walletConnectService.addEventListener('session_error', (data: any) => {
      this.showErrorMessage(`Error: ${data.error instanceof Error ? data.error.message : 'Unknown error'}`);
    });
    
    // Handle session deletion
    this.walletConnectService.addEventListener('session_delete', () => {
      this.showInfoMessage('Wallet session deleted');
    });
    
    // Handle session expiry
    this.walletConnectService.addEventListener('session_expire', () => {
      this.showWarningMessage('Wallet session expired. Please reconnect.');
    });
    
    // Handle QR code generation
    this.walletConnectService.addEventListener('qr_generated', (data: any) => {
      this.renderQRCode(data.uri);
    });
    
    // Handle dApp connection
    this.walletConnectService.addEventListener('dapp_connected', (data: any) => {
      this.showDAppConnectedMessage(data.metadata);
    });
    
    // Handle dApp disconnection
    this.walletConnectService.addEventListener('dapp_disconnected', () => {
      this.showInfoMessage('dApp disconnected');
    });
  }
  
  /**
   * Show a success message
   * @param message The message to show
   */
  private showSuccessMessage(message: string): void {
    this.buffer.innerHTML = '';
    const successMsg = document.createElement('p');
    successMsg.textContent = message;
    successMsg.className = 'text-green-400';
    this.buffer.appendChild(successMsg);
  }
  
  /**
   * Show an error message
   * @param message The message to show
   */
  private showErrorMessage(message: string): void {
    this.buffer.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.textContent = message;
    errorMsg.className = 'text-red-500';
    this.buffer.appendChild(errorMsg);
  }
  
  /**
   * Show an info message
   * @param message The message to show
   */
  private showInfoMessage(message: string): void {
    this.buffer.innerHTML = '';
    const infoMsg = document.createElement('p');
    infoMsg.textContent = message;
    infoMsg.className = 'text-blue-400';
    this.buffer.appendChild(infoMsg);
  }
  
  /**
   * Show a warning message
   * @param message The message to show
   */
  private showWarningMessage(message: string): void {
    this.buffer.innerHTML = '';
    const warningMsg = document.createElement('p');
    warningMsg.textContent = message;
    warningMsg.className = 'text-yellow-400';
    this.buffer.appendChild(warningMsg);
  }
  
  /**
   * Show dApp connected message with metadata
   * @param metadata dApp metadata
   */
  private showDAppConnectedMessage(metadata: any): void {
    this.buffer.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'bg-gray-800 p-4 rounded-lg shadow-lg';
    
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-2';
    title.textContent = 'dApp Connected';
    container.appendChild(title);
    
    if (metadata) {
      const appName = document.createElement('p');
      appName.className = 'text-green-400 mb-2';
      appName.textContent = `App: ${metadata.name || 'Unknown'}`;
      container.appendChild(appName);
      
      if (metadata.description) {
        const description = document.createElement('p');
        description.className = 'text-gray-400 text-sm mb-2';
        description.textContent = metadata.description;
        container.appendChild(description);
      }
      
      if (metadata.url) {
        const url = document.createElement('p');
        url.className = 'text-blue-400 text-sm mb-2';
        url.textContent = `URL: ${metadata.url}`;
        container.appendChild(url);
      }
    }
    
    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'mt-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.onclick = async () => {
      try {
        await this.walletConnectService.disconnectFromDApp();
      } catch (error) {
        this.showErrorMessage(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    container.appendChild(disconnectBtn);
    
    this.buffer.appendChild(container);
  }
  
  /**
   * Render QR code for WalletConnect session
   * @param uri WalletConnect URI
   */
  private renderQRCode(uri: string): void {
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
    copyInput.value = uri;
    copyInput.readOnly = true;
    copyInput.className = 'flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-mono border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';
    
    const copyButton = document.createElement('button');
    copyButton.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500';
    copyButton.textContent = 'Copy';
    
    // Add copy functionality
    copyButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(uri);
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
    WalletConnectService.generateQrCode(qrCanvas, uri);
  }
  
  /**
   * Render the URI input form for connecting to a dApp
   */
  public renderURIInputForm(onSubmit: (uri: string) => void): void {
    this.buffer.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'max-w-2xl mx-auto bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg';
    
    // Add WalletConnect logo
    const logoContainer = document.createElement('div');
    logoContainer.className = 'text-center mb-6';
    
    const logo = document.createElement('img');
    logo.src = 'https://raw.githubusercontent.com/WalletConnect/walletconnect-assets/master/Logo/Blue%20(Default)/Logo.png';
    logo.alt = 'WalletConnect Logo';
    logo.className = 'h-16 mx-auto mb-4';
    logoContainer.appendChild(logo);
    
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold text-white mb-2';
    title.textContent = 'Connect to dApp';
    logoContainer.appendChild(title);
    
    const description = document.createElement('p');
    description.className = 'text-gray-400 text-sm';
    description.textContent = 'Paste the pairing code below to connect to your Safe{Wallet} via WalletConnect';
    logoContainer.appendChild(description);
    
    container.appendChild(logoContainer);
    
    // Create form
    const form = document.createElement('form');
    form.className = 'space-y-4';
    
    const inputGroup = document.createElement('div');
    inputGroup.className = 'space-y-2';
    
    const inputLabel = document.createElement('label');
    inputLabel.htmlFor = 'wc-uri-input';
    inputLabel.className = 'text-sm font-medium text-gray-300';
    inputLabel.textContent = 'WalletConnect URI';
    inputGroup.appendChild(inputLabel);
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'wc-uri-input';
    input.className = 'w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-mono border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500';
    input.placeholder = 'wc:...';
    inputGroup.appendChild(input);
    
    const helperText = document.createElement('p');
    helperText.className = 'text-xs text-gray-400 mt-1';
    helperText.textContent = 'The URI should start with "wc:" and is provided by the dApp you want to connect to.';
    inputGroup.appendChild(helperText);
    
    form.appendChild(inputGroup);
    
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'pt-4';
    
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500';
    submitButton.textContent = 'Connect';
    buttonGroup.appendChild(submitButton);
    
    form.appendChild(buttonGroup);
    
    form.onsubmit = (e) => {
      e.preventDefault();
      const uri = input.value.trim();
      if (uri && uri.startsWith('wc:')) {
        onSubmit(uri);
      } else {
        this.showErrorMessage('Invalid WalletConnect URI. It should start with "wc:"');
      }
    };
    
    container.appendChild(form);
    this.buffer.appendChild(container);
  }
} 