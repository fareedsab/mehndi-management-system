import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-finished-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finished-products.html',
  styleUrl: './finished-products.css'
})
export class FinishedProductsComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  products = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  activeTab = signal<string>('list'); // 'list' or 'add'
  searchTerm = '';

  // Form states
  newProduct = {
    name: '',
    description: '',
    status: 'Active'
  };

  selectedProduct = signal<any | null>(null);
  activeModal = signal<string | null>(null); // 'edit'
  modalError = signal<string | null>(null);
  modalSuccess = signal<string | null>(null);

  editData = {
    name: '',
    description: '',
    status: 'Active'
  };

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts(): void {
    this.isLoading.set(true);
    this.apiService.getFinishedProducts().subscribe({
      next: (res) => {
        this.products.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Fetch finished products error:', err);
        this.isLoading.set(false);
      }
    });
  }

  get filteredProducts(): any[] {
    if (!this.searchTerm.trim()) {
      return this.products();
    }
    const term = this.searchTerm.toLowerCase();
    return this.products().filter(p => 
      p.name.toLowerCase().includes(term) || 
      (p.description && p.description.toLowerCase().includes(term))
    );
  }

  // Create Finished Product
  onSubmitAdd(): void {
    if (!this.newProduct.name.trim()) return;

    this.apiService.createFinishedProduct(this.newProduct).subscribe({
      next: () => {
        this.newProduct = {
          name: '',
          description: '',
          status: 'Active'
        };
        this.activeTab.set('list');
        this.loadProducts();
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to create finished product.');
      }
    });
  }

  // Open Edit Modal
  openModal(product: any): void {
    this.selectedProduct.set(product);
    this.activeModal.set('edit');
    this.modalError.set(null);
    this.modalSuccess.set(null);

    this.editData = {
      name: product.name,
      description: product.description || '',
      status: product.status
    };
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedProduct.set(null);
    this.modalError.set(null);
    this.modalSuccess.set(null);
  }

  // Submit Edit Metadata
  onSubmitEdit(): void {
    const prod = this.selectedProduct();
    if (!prod) return;

    this.apiService.updateFinishedProduct(prod.id, this.editData).subscribe({
      next: () => {
        this.modalSuccess.set('Finished product details updated successfully.');
        setTimeout(() => {
          this.closeModal();
          this.loadProducts();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to update product details.');
      }
    });
  }
}
