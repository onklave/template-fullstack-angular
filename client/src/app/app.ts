import { Component, OnInit, inject, signal } from '@angular/core';
import { Item, ItemsService } from './items.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly items = inject(ItemsService);

  protected readonly rows = signal<Item[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected add(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.items.create(trimmed).subscribe({
      next: (item) => {
        this.rows.update((rows) => [item, ...rows]);
        this.error.set(null);
        this.busy.set(false);
      },
      error: () => this.fail('Could not add that item.'),
    });
  }

  private load(): void {
    this.busy.set(true);
    this.items.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.error.set(null);
        this.busy.set(false);
      },
      error: () => this.fail('Could not reach the API at /api/items.'),
    });
  }

  private fail(message: string): void {
    this.error.set(message);
    this.busy.set(false);
  }
}
