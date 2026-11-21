import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { forkJoin } from 'rxjs';
import { money } from '../../shared/money';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  readonly money = money;

  isLoading = signal<boolean>(true);
  
  // Dashboard metrics
  totalRawProducts = signal<number>(0);
  totalFinishedProducts = signal<number>(0);
  lowStockCount = signal<number>(0);
  totalBatches = signal<number>(0);

  // Purchase / vendor credit metrics
  totalPayable = signal<number>(0);
  totalOverdue = signal<number>(0);
  vendorsOverLimit = signal<number>(0);
  openOrders = signal<number>(0);

  lowStockProducts = signal<any[]>([]);
  recentBatches = signal<any[]>([]);
  recentOrders = signal<any[]>([]);

  ngOnInit(): void {
    this.loadDashboardData();
  }

  loadDashboardData(): void {
    this.isLoading.set(true);

    forkJoin({
      rawProducts: this.apiService.getRawProducts(),
      finishedProducts: this.apiService.getFinishedProducts(),
      batches: this.apiService.getBatches(),
      balances: this.apiService.getVendorBalancesReport(),
      orders: this.apiService.getPurchaseOrders()
    }).subscribe({
      next: (res) => {
        // Raw products statistics
        this.totalRawProducts.set(res.rawProducts.length);
        const lowStock = res.rawProducts.filter(p => p.isLowStock);
        this.lowStockCount.set(lowStock.length);
        this.lowStockProducts.set(lowStock);

        // Finished products statistics
        this.totalFinishedProducts.set(res.finishedProducts.length);

        // Batches statistics
        this.totalBatches.set(res.batches.length);
        this.recentBatches.set(res.batches.slice(0, 5)); // Get latest 5

        // Vendor credit statistics
        this.totalPayable.set(res.balances?.totals?.totalPayable || 0);
        this.totalOverdue.set(res.balances?.totals?.totalOverdue || 0);
        this.vendorsOverLimit.set(res.balances?.totals?.vendorsOverLimit || 0);
        this.openOrders.set(
          res.orders.filter((o: any) => o.status === 'Ordered' || o.status === 'Partially Received').length
        );
        this.recentOrders.set(res.orders.slice(0, 5));

        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load dashboard data:', err);
        this.isLoading.set(false);
      }
    });
  }
}
