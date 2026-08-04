import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Item, ItemsService } from './items.service';

describe('ItemsService', () => {
  let service: ItemsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ItemsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists items from the same-origin path /api/items', () => {
    const rows: Item[] = [{ id: '1', name: 'first', createdAt: '2026-08-04T00:00:00.000Z' }];
    let received: Item[] | undefined;

    service.list().subscribe((r) => (received = r));

    const req = http.expectOne('/api/items');
    expect(req.request.method).toBe('GET');
    // The URL must stay relative. An absolute URL here would be a cross-origin
    // call, which is exactly what this template is built to avoid.
    expect(req.request.url.startsWith('http')).toBe(false);
    req.flush(rows);

    expect(received).toEqual(rows);
  });

  it('posts new items to /api/items', () => {
    service.create('second').subscribe();

    const req = http.expectOne('/api/items');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'second' });
    req.flush({ id: '2', name: 'second', createdAt: '2026-08-04T00:00:01.000Z' });
  });
});
