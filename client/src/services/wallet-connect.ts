import { SignClient } from '@walletconnect/sign-client';
import QRCode from 'qrcode';

export class WalletConnectService {
  private signClient: any; // WalletConnect SignClient instance for signer wallet connections
  private dAppClient: any; // WalletConnect SignClient instance for dApp connections
  private sessionTopic: string | null = null; // Store the signer WalletConnect session topic
  private dAppSessionTopic: string | null = null; // Store the dApp WalletConnect session topic
  private isConnecting: boolean = false; // Flag to track connection state
  private listeners: Map<string, Function[]> = new Map();

  constructor() {
    // Initialize empty listeners map for events
    this.listeners.set('session_delete', []);
    this.listeners.set('session_expire', []);
    this.listeners.set('session_update', []);
    this.listeners.set('session_connected', []);
    this.listeners.set('session_disconnected', []);
  }

  /**
   * Add event listener
   * @param event Event name
   * @param callback Callback function
   */
  public addEventListener(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  /**
   * Remove event listener
   * @param event Event name
   * @param callback Callback function
   */
  public removeEventListener(event: string, callback: Function): void {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event) || [];
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit event to all listeners
   * @param event Event name
   * @param data Event data
   */
  private emit(event: string, data?: any): void {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(callback => callback(data));
  }

  /**
   * Get the current session topic
   * @returns The current session topic
   */
  public getSessionTopic(): string | null {
    return this.sessionTopic;
  }

  /**
   * Get the dApp session topic
   * @returns The dApp session topic
   */
  public getDAppSessionTopic(): string | null {
    return this.dAppSessionTopic;
  }

  /**
   * Setup WalletConnect event listeners
   */
  private setupWalletConnectListeners(): void {
    if (!this.signClient) return;

    // Handle session deletion
    this.signClient.on('session_delete', ({ topic }: { topic: string }) => {
      console.log(`WalletConnect session deleted: ${topic}`);
      if (topic === this.sessionTopic) {
        this.sessionTopic = null;
        this.emit('session_delete', { topic });
      }
    });

    // Handle session expiry
    this.signClient.on('session_expire', ({ topic }: { topic: string }) => {
      console.log(`WalletConnect session expired: ${topic}`);
      if (topic === this.sessionTopic) {
        this.sessionTopic = null;
        this.emit('session_expire', { topic });
      }
    });

    // Handle session events
    this.signClient.on('session_event', (event: any) => {
      console.log('WalletConnect session event:', event);
      this.emit('session_update', event);
    });
  }

  /**
   * Initialize WalletConnect with the selected chain ID
   * @param chainId Network chain ID
   * @returns Promise that resolves when initialization is complete
   */
  public async initialize(chainId: number): Promise<void> {
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
            this.emit('session_connected', { message: 'Already connected to wallet!' });
            return;
          }
        } catch (e) {
          // Session not found or expired, clear it
          this.sessionTopic = null;
          this.emit('session_disconnected', null);
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

      // Return the connection URI and QR code data
      this.emit('qr_generated', { uri: connectResult.uri });

      // Wait for approval
      const session = await connectResult.approval();
      this.sessionTopic = session.topic;

      // Get the connected address
      const account = session.namespaces.eip155.accounts[0].split(':')[2];

      // Emit successful connection event
      this.emit('session_connected', { address: account, session });

    } catch (error: unknown) {
      // Clear session state on error
      this.sessionTopic = null;

      console.error('WalletConnect initialization failed:', error);
      this.emit('session_error', { error });
    } finally {
      // Reset connecting flag
      this.isConnecting = false;
    }
  }

  /**
   * Connect with WalletConnect URI
   * @param uri WalletConnect URI
   * @returns Promise that resolves when connection is complete
   */
  public async connectWithUri(uri?: string): Promise<{ uri: string }> {
    // If no URI is provided and we have a sign client, create a new connection
    if (!uri && this.signClient) {
      try {
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
              chains: ['eip155:1'], // Default to Ethereum mainnet
              events: ['accountsChanged', 'chainChanged']
            }
          }
        });

        return { uri: connectResult.uri };
      } catch (error) {
        console.error('Error creating WalletConnect connection:', error);
        throw error;
      }
    }

    if (!uri) {
      throw new Error('No URI provided and unable to create connection');
    }

    try {
      // Parse the URI
      await this.signClient.pair({ uri });

      // Return the session URI
      return { uri };
    } catch (error) {
      console.error('Error connecting with WalletConnect URI:', error);
      throw error;
    }
  }

  /**
   * Disconnect active WalletConnect session
   */
  public async disconnect(): Promise<void> {
    if (!this.signClient || !this.sessionTopic) {
      throw new Error('No WalletConnect session to disconnect');
    }

    try {
      await this.signClient.disconnect({
        topic: this.sessionTopic,
        reason: {
          code: 6000,
          message: 'User disconnected'
        }
      });

      // Reset the session topic
      this.sessionTopic = null;
      this.emit('session_disconnected', null);
    } catch (error) {
      console.error('WalletConnect disconnection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect from dApp
   */
  public async disconnectFromDApp(): Promise<void> {
    if (!this.dAppClient || !this.dAppSessionTopic) {
      throw new Error('No dApp is currently connected');
    }

    try {
      // Disconnect the current dApp session
      await this.dAppClient.disconnect({
        topic: this.dAppSessionTopic,
        reason: {
          code: 6000,
          message: 'User disconnected'
        }
      });

      // Reset the dApp session topic
      this.dAppSessionTopic = null;
      this.emit('dapp_disconnected', null);
    } catch (error) {
      console.error('Failed to disconnect from dApp:', error);
      throw error;
    }
  }

  /**
   * Initialize dApp connection
   * @param uri WalletConnect URI
   */
  public async initializeDAppConnection(uri?: string): Promise<void> {
    // Initialize dApp WalletConnect client if not already initialized
    if (!this.dAppClient) {
      this.dAppClient = await SignClient.init({
        projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID,
        metadata: {
          name: 'Minimalist Safe{Wallet}',
          description: 'A minimalist interface for Safe{Wallet}',
          url: window.location.origin,
          icons: ['https://walletconnect.com/walletconnect-logo.svg']
        }
      });
    }

    if (!uri) {
      throw new Error('No dApp URI provided');
    }

    try {
      // Pair with the provided URI
      const pairResult = await this.dAppClient.pair({ uri });

      // Store the session topic
      if (pairResult && pairResult.topic) {
        this.dAppSessionTopic = pairResult.topic;

        // Extract metadata from the pairing
        const dAppMetadata = pairResult.peer?.metadata;

        this.emit('dapp_connected', { metadata: dAppMetadata });
      }
    } catch (error) {
      console.error('Error connecting with dApp URI:', error);
      throw error;
    }
  }

  /**
   * Generate QR code canvas for the WalletConnect URI
   * @param canvas Canvas element to render QR code on
   * @param uri WalletConnect URI
   */
  public static async generateQrCode(canvas: HTMLCanvasElement, uri: string): Promise<void> {
    await QRCode.toCanvas(canvas, uri, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  }
}