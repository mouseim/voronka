export interface VkLongPollServer {
  key: string
  server: string
  ts: string
}

export interface VkLongPollSettings {
  enabled: boolean
  api_version?: string
  events?: Record<string, boolean | number>
}

export interface VkApi {
  sendMessage(peerId: string, message: string, keyboard?: string, attachment?: string): Promise<number>
  getLongPollServer(): Promise<VkLongPollServer>
  getLongPollSettings?(): Promise<VkLongPollSettings>
  answerMessageEvent(eventId: string, userId: string, peerId: string): Promise<void>
  getMessagesPhotoUploadServer(peerId: string): Promise<VkUploadServer>
  saveMessagesPhoto(upload: VkPhotoUploadResult): Promise<VkSavedPhoto[]>
  getMessagesDocumentUploadServer(peerId: string, type: 'doc' | 'audio_message'): Promise<VkUploadServer>
  saveDocument(file: string, title?: string): Promise<VkSavedDocument>
}

export interface VkUploadServer { upload_url: string }
export interface VkPhotoUploadResult { server: number; photo: string; hash: string }
export interface VkSavedAttachmentIdentity { id: number; owner_id: number; access_key?: string }
export type VkSavedPhoto = VkSavedAttachmentIdentity
export interface VkSavedDocument { type: string; doc?: VkSavedAttachmentIdentity; audio_message?: VkSavedAttachmentIdentity }

export class VkApiClient implements VkApi {
  constructor(
    private readonly token: string,
    private readonly groupId: string,
    private readonly version = '5.199',
    private readonly fetcher: typeof fetch = fetch,
    private readonly randomId: () => number = vkRandomId,
  ) {}

  async sendMessage(peerId: string, message: string, keyboard?: string, attachment?: string) {
    return this.request<number>('messages.send', {
      peer_id: peerId,
      random_id: this.randomId(),
      message,
      ...(keyboard ? { keyboard } : {}),
      ...(attachment ? { attachment } : {}),
    })
  }

  async getLongPollServer() {
    return this.request<VkLongPollServer>('groups.getLongPollServer', { group_id: this.groupId })
  }

  async getLongPollSettings() {
    return this.request<VkLongPollSettings>('groups.getLongPollSettings', { group_id: this.groupId })
  }

  async answerMessageEvent(eventId: string, userId: string, peerId: string) {
    await this.request<number>('messages.sendMessageEventAnswer', {
      event_id: eventId,
      user_id: userId,
      peer_id: peerId,
    })
  }

  async getMessagesPhotoUploadServer(peerId: string) {
    return this.request<VkUploadServer>('photos.getMessagesUploadServer', { peer_id: peerId })
  }

  async saveMessagesPhoto(upload: VkPhotoUploadResult) {
    return this.request<VkSavedPhoto[]>('photos.saveMessagesPhoto', {
      server: upload.server,
      photo: upload.photo,
      hash: upload.hash,
    })
  }

  async getMessagesDocumentUploadServer(peerId: string, type: 'doc' | 'audio_message') {
    return this.request<VkUploadServer>('docs.getMessagesUploadServer', { peer_id: peerId, type })
  }

  async saveDocument(file: string, title?: string) {
    return this.request<VkSavedDocument>('docs.save', { file, ...(title ? { title } : {}) })
  }

  private async request<T>(method: string, parameters: Record<string, string | number>) {
    const body = new URLSearchParams({ access_token: this.token, v: this.version })
    Object.entries(parameters).forEach(([key, value]) => body.set(key, String(value)))
    const response = await this.fetcher(`https://api.vk.com/method/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) throw new Error(`VK_HTTP_ERROR:${response.status}`)
    const payload = await response.json() as { response?: T; error?: { error_code: number; error_msg: string } }
    if (payload.error) throw new Error(`VK_API_ERROR:${payload.error.error_code}:${payload.error.error_msg}`)
    if (payload.response === undefined) throw new Error(`VK_API_INVALID_RESPONSE:${method}`)
    return payload.response
  }
}

function vkRandomId() {
  return Math.floor(Math.random() * 4_294_967_295) - 2_147_483_648
}
