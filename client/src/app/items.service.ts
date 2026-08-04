import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Item {
  /**
   * A string, not a number. The column is BIGINT and node-postgres returns
   * int8 as a string so it cannot lose precision above 2^53.
   */
  id: string;
  name: string;
  createdAt: string;
}

/**
 * The API base path.
 *
 * It is RELATIVE on purpose. In production the Angular bundle and the API are
 * two separate workloads behind ONE host, routed by path (`/` -> web,
 * `/api` -> api). So `/api/items` is same-origin: the browser sends the
 * session it already has, no API key travels in the bundle, and no CORS
 * preflight ever happens. Do not turn this into an absolute URL — that is what
 * creates a cross-origin call and the CORS problem that follows it.
 */
const API_BASE = '/api';

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Item[]> {
    return this.http.get<Item[]>(`${API_BASE}/items`);
  }

  create(name: string): Observable<Item> {
    return this.http.post<Item>(`${API_BASE}/items`, { name });
  }
}
