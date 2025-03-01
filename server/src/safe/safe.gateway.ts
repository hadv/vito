import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SafeService } from './safe.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class SafeGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly safeService: SafeService,
    private readonly configService: ConfigService,
  ) {}

  @SubscribeMessage('connectWallet')
  async handleConnectWallet(): Promise<void> {
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
  async handleGetSafeInfo(): Promise<void> {
    const safeAddress = this.configService.get<string>('SAFE_ADDRESS');
    console.log('SAFE_ADDRESS from env:', safeAddress); // Debug log
    if (!safeAddress) {
      this.server.emit('error', { message: 'Safe address not configured in environment variables' });
      return;
    }
    try {
      const safeInfo = await this.safeService.getSafeInfo(safeAddress);
      this.server.emit('safeInfo', safeInfo);
    } catch (err) {
      this.server.emit('error', { message: err.message });
    }
  }
}
