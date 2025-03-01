import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SafeService } from './safe.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class SafeGateway {
  @WebSocketServer()
  server: Server;

  private safeAddress: string | null = null;

  constructor(
    private readonly safeService: SafeService,
    private readonly configService: ConfigService,
  ) {}

  @SubscribeMessage('connectWallet')
  async handleConnectWallet(client: any, data: { safeAddress: string }): Promise<void> {
    if (!data || !data.safeAddress) {
      this.server.emit('error', { message: 'Safe address required. Use :c first' });
      return;
    }
    this.safeAddress = data.safeAddress;
    const { uri, approval } = await this.safeService.connectWallet();
    this.server.emit('walletUri', { uri });

    approval()
      .then((session) => {
        const address = session.namespaces.eip155.accounts[0].split(':')[2];
        this.server.emit('signerAddress', { address });
      })
      .catch((err) => {
        console.error('WalletConnect approval failed:', err);
        this.server.emit('error', { message: err.message });
      });
  }

  @SubscribeMessage('getSafeInfo')
  async handleGetSafeInfo(client: any, data: { safeAddress: string }): Promise<void> {
    if (!data || !data.safeAddress) {
      this.server.emit('error', { message: 'Safe address required. Use :c first' });
      return;
    }
    try {
      const safeInfo = await this.safeService.getSafeInfo(data.safeAddress);
      this.server.emit('safeInfo', safeInfo);
    } catch (err) {
      const errorMessage = err.message.includes('call revert exception')
        ? `Invalid Safe address: ${data.safeAddress}`
        : `Failed to fetch Safe info: ${err.message}`;
      this.server.emit('error', { message: errorMessage });
    }
  }
}
