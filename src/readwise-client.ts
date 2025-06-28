import { 
  ReadwiseDocument, 
  CreateDocumentRequest, 
  UpdateDocumentRequest, 
  ListDocumentsParams, 
  ListDocumentsResponse,
  ReadwiseTag,
  ReadwiseConfig
} from './types.js';

export class ReadwiseClient {
  private readonly baseUrl = 'https://readwise.io/api/v3';
  private readonly authUrl = 'https://readwise.io/api/v2/auth/';
  private readonly token: string;

  constructor(config: ReadwiseConfig) {
    this.token = config.token;
  }

  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Token ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Readwise API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  async validateAuth(): Promise<{ detail: string }> {
    return this.makeRequest(this.authUrl);
  }

  async createDocument(data: CreateDocumentRequest): Promise<ReadwiseDocument> {
    return this.makeRequest<ReadwiseDocument>('/save/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listDocuments(params: ListDocumentsParams = {}): Promise<ListDocumentsResponse> {
    // If withFullContent is requested, first check the document count
    if (params.withFullContent) {
      const countParams = { ...params };
      delete countParams.withFullContent;
      delete countParams.withHtmlContent; // Also remove HTML content for the count check
      
      const countSearchParams = new URLSearchParams();
      Object.entries(countParams).forEach(([key, value]) => {
        if (value !== undefined) {
          countSearchParams.append(key, String(value));
        }
      });

      const countQuery = countSearchParams.toString();
      const countEndpoint = `/list/${countQuery ? `?${countQuery}` : ''}`;
      
      const countResponse = await this.makeRequest<ListDocumentsResponse>(countEndpoint);
      
      if (countResponse.count > 5) {
        throw new Error(
          `Too many documents found (${countResponse.count}). ` +
          'When requesting full content, please be more specific in your query to reduce the number of documents to 5 or fewer. ' +
          'You can use filters like location, category, tag, or other search parameters to narrow down your results.'
        );
      }
    }

    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const query = searchParams.toString();
    const endpoint = `/list/${query ? `?${query}` : ''}`;
    
    return this.makeRequest<ListDocumentsResponse>(endpoint);
  }

  async updateDocument(id: string, data: UpdateDocumentRequest): Promise<ReadwiseDocument> {
    return this.makeRequest<ReadwiseDocument>(`/update/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.makeRequest(`/delete/${id}/`, {
      method: 'DELETE',
    });
  }

  async listTags(): Promise<ReadwiseTag[]> {
    return this.makeRequest<ReadwiseTag[]>('/tags/');
  }

  async searchDocumentsByTopic(searchTerms: string[]): Promise<ReadwiseDocument[]> {
    // Fetch all documents without full content for performance
    const allDocuments: ReadwiseDocument[] = [];
    let nextPageCursor: string | undefined;
    
    do {
      const params: ListDocumentsParams = {
        withFullContent: false,
        withHtmlContent: false,
      };
      
      if (nextPageCursor) {
        params.pageCursor = nextPageCursor;
      }
      
      const response = await this.listDocuments(params);
      allDocuments.push(...response.results);
      nextPageCursor = response.nextPageCursor;
    } while (nextPageCursor);

    // Create regex patterns from search terms (case-insensitive)
    const regexPatterns = searchTerms.map(term => 
      new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    );

    // Filter documents that match any of the search terms
    const matchingDocuments = allDocuments.filter(doc => {
      // Extract searchable text fields
      const searchableFields = [
        doc.title || '',
        doc.summary || '',
        doc.notes || '',
        // Handle tags - they can be string array or object
        Array.isArray(doc.tags) ? doc.tags.join(' ') : '',
      ];

      const searchableText = searchableFields.join(' ').toLowerCase();

      // Check if any regex pattern matches
      return regexPatterns.some(pattern => pattern.test(searchableText));
    });

    return matchingDocuments;
  }
}