import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { App } from './app';
import { Item, ItemsService } from './items.service';

/** Stand-in for the real service so the component test makes no HTTP call. */
class FakeItemsService {
  rows: Item[] = [{ id: '1', name: 'from the api', createdAt: '2026-08-04T09:00:00.000Z' }];
  created: string[] = [];
  failing = false;

  list(): Observable<Item[]> {
    return this.failing ? throwError(() => new Error('offline')) : of(this.rows);
  }

  create(name: string): Observable<Item> {
    this.created.push(name);
    return of({ id: '2', name, createdAt: '2026-08-04T09:00:01.000Z' });
  }
}

async function render(fake: FakeItemsService) {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [{ provide: ItemsService, useValue: fake }],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  return fixture;
}

describe('App', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders items fetched from the API on init', async () => {
    const fixture = await render(new FakeItemsService());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('from the api');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('li').length).toBe(1);
  });

  it('submitting the form sends the name to the API and prepends the result', async () => {
    const fake = new FakeItemsService();
    const fixture = await render(fake);
    const root = fixture.nativeElement as HTMLElement;

    const input = root.querySelector('input') as HTMLInputElement;
    input.value = '  a new item  ';
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(fake.created).toEqual(['a new item']);
    expect(root.querySelectorAll('li')[0].textContent).toContain('a new item');
  });

  it('shows an honest error instead of empty state when the API is unreachable', async () => {
    const fake = new FakeItemsService();
    fake.failing = true;
    const fixture = await render(fake);

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('/api/items');
  });
});
