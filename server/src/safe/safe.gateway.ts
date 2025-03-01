import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SafeService } from './safe.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class SafeGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly safeService: SafeService) {}

  @SubscribeMessage('connectWallet')
  async handleConnectWallet(): Promise<void> {
    const { uri, approval } = await this.safeService.connectWallet();
    this.server.emit('walletUri', { uri });

    // Wait for approval and emit signerAddress from the same session
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
}
