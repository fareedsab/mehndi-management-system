import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { money, today } from '../../shared/money';

@Component({
  selector: 'app-vendor-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './vendor-ledger.html',
  styleUrl: './vendor-ledger.css'
})
export class VendorLedgerComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly money = money;
  readonly todayStr = today();

  vendors = signal<any[]>([]);
  statement = signal<any | null>(null);
  payments = signal<any[]>([]);
  isLoading = signal<boolean>(true);

  vendorId: number | null = null;
  range = { startDate: '', endDate: today() };

  ngOnInit(): void {
    this.apiService.getVendors().subscribe({
      next: (list) => {
        this.vendors.set(list);
        const fromQuery = Number(this.route.snapshot.queryParamMap.get('vendorId'));
        const chosen = list.find((v: any) => v.id === fromQuery) || list.find((v: any) => v.status === 'Active') || list[0];
        if (chosen) {
          this.vendorId = chosen.id;
          this.loadStatement();
        } else {
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        console.error('Failed to load vendors for ledger:', err);
        this.isLoading.set(false);
      }
    });
  }

  onVendorChange(): void {
    this.loadStatement();
  }

  loadStatement(): void {
    if (!this.vendorId) return;
    this.isLoading.set(true);

    const params: { startDate?: string; endDate?: string } = {};
    if (this.range.startDate) params.startDate = this.range.startDate;
    if (this.range.endDate) params.endDate = this.range.endDate;

    this.apiService.getVendorLedger(this.vendorId, params).subscribe({
      next: (res) => {
        this.statement.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load vendor statement:', err);
        this.statement.set(null);
        this.isLoading.set(false);
      }
    });

    this.apiService.getVendorPayments(this.vendorId).subscribe({
      next: (res) => this.payments.set(res),
      error: () => this.payments.set([])
    });
  }

  setQuickRange(days: number): void {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    this.range.startDate = start.toISOString().slice(0, 10);
    this.range.endDate = end.toISOString().slice(0, 10);
    this.loadStatement();
  }

  clearRange(): void {
    this.range = { startDate: '', endDate: today() };
    this.loadStatement();
  }

  printStatement(): void {
    window.print();
  }

  get entryRows(): any[] {
    return this.statement()?.entries || [];
  }

  directionClass(direction: string): string {
    return direction === 'Credit' ? 'text-danger' : 'text-success';
  }
}
