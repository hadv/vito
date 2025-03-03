import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
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

  @SubscribeMessage('getSafeInfo')
  async handleGetSafeInfo(@MessageBody() data: { safeAddress: string; network: string }) {
    try {
      const safeInfo = await this.safeService.getSafeInfo(data.safeAddress, data.network);
      this.server.emit('safeInfo', safeInfo);
    } catch (error) {
      this.server.emit('error', error.message);
    }
  }
}
