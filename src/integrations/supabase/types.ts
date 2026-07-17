export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organizer_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          organizer_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organizer_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: []
      }
      bulk_messages: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          recipient_count: number
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          recipient_count?: number
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          recipient_count?: number
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      checkin_log: {
        Row: {
          created_at: string
          device_label: string | null
          event_id: string | null
          id: string
          result: string
          ticket_id: string | null
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          event_id?: string | null
          id?: string
          result: string
          ticket_id?: string | null
        }
        Update: {
          created_at?: string
          device_label?: string | null
          event_id?: string | null
          id?: string
          result?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkin_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          event_id: string
          id: string
          max_uses: number | null
          type: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          event_id: string
          id?: string
          max_uses?: number | null
          type: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          event_id?: string
          id?: string
          max_uses?: number | null
          type?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      email_jobs: {
        Row: {
          attempts: number
          campaign_id: string | null
          created_at: string
          dedup_key: string | null
          event_id: string | null
          html: string | null
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          order_id: string | null
          recipient: string
          status: string
          subject: string | null
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          campaign_id?: string | null
          created_at?: string
          dedup_key?: string | null
          event_id?: string | null
          html?: string | null
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          order_id?: string | null
          recipient: string
          status?: string
          subject?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          campaign_id?: string | null
          created_at?: string
          dedup_key?: string | null
          event_id?: string | null
          html?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          order_id?: string | null
          recipient?: string
          status?: string
          subject?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "bulk_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_jobs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          ga4_measurement_id: string | null
          id: string
          meta_pixel_id: string | null
          organizer_id: string
          qr_secret: string
          slug: string
          starts_at: string
          status: string
          timezone: string
          title: string
          venue_address: string | null
          venue_name: string | null
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          ga4_measurement_id?: string | null
          id?: string
          meta_pixel_id?: string | null
          organizer_id: string
          qr_secret?: string
          slug: string
          starts_at: string
          status?: string
          timezone?: string
          title: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          ga4_measurement_id?: string | null
          id?: string
          meta_pixel_id?: string | null
          organizer_id?: string
          qr_secret?: string
          slug?: string
          starts_at?: string
          status?: string
          timezone?: string
          title?: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          quantity: number
          ticket_type_id: string
          unit_price_cents: number
        }
        Insert: {
          id?: string
          order_id: string
          quantity: number
          ticket_type_id: string
          unit_price_cents: number
        }
        Update: {
          id?: string
          order_id?: string
          quantity?: number
          ticket_type_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: string | null
          billing_dic: string | null
          billing_ic_dph: string | null
          billing_ico: string | null
          billing_name: string | null
          buyer_email: string
          buyer_name: string | null
          buyer_phone: string | null
          cash_received_cents: number | null
          coupon_id: string | null
          created_at: string
          custom_answers: Json | null
          discount_cents: number
          event_id: string
          expires_at: string | null
          fee_cents: number
          fiscal_code: string | null
          gopay_payment_id: string | null
          id: string
          paid_at: string | null
          payment_method: string
          receipt_number: string | null
          settlement_id: string | null
          sold_by: string | null
          status: string
          subtotal_cents: number
          terms_accepted_at: string | null
          total_cents: number
        }
        Insert: {
          billing_address?: string | null
          billing_dic?: string | null
          billing_ic_dph?: string | null
          billing_ico?: string | null
          billing_name?: string | null
          buyer_email: string
          buyer_name?: string | null
          buyer_phone?: string | null
          cash_received_cents?: number | null
          coupon_id?: string | null
          created_at?: string
          custom_answers?: Json | null
          discount_cents?: number
          event_id: string
          expires_at?: string | null
          fee_cents?: number
          fiscal_code?: string | null
          gopay_payment_id?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string
          receipt_number?: string | null
          settlement_id?: string | null
          sold_by?: string | null
          status?: string
          subtotal_cents?: number
          terms_accepted_at?: string | null
          total_cents?: number
        }
        Update: {
          billing_address?: string | null
          billing_dic?: string | null
          billing_ic_dph?: string | null
          billing_ico?: string | null
          billing_name?: string | null
          buyer_email?: string
          buyer_name?: string | null
          buyer_phone?: string | null
          cash_received_cents?: number | null
          coupon_id?: string | null
          created_at?: string
          custom_answers?: Json | null
          discount_cents?: number
          event_id?: string
          expires_at?: string | null
          fee_cents?: number
          fiscal_code?: string | null
          gopay_payment_id?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string
          receipt_number?: string | null
          settlement_id?: string | null
          sold_by?: string | null
          status?: string
          subtotal_cents?: number
          terms_accepted_at?: string | null
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_members: {
        Row: {
          created_at: string
          id: string
          organizer_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organizer_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organizer_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_members_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizers: {
        Row: {
          address: string | null
          admin_notes: string | null
          brand_color: string | null
          brand_logo_url: string | null
          contact_email: string | null
          created_at: string
          dic: string | null
          email: string | null
          fee_min_cents: number
          fee_percent: number
          gopay_goid: string | null
          iban: string | null
          ic_dph: string | null
          ico: string | null
          id: string
          name: string
          phone: string | null
          slug: string
          status: string
        }
        Insert: {
          address?: string | null
          admin_notes?: string | null
          brand_color?: string | null
          brand_logo_url?: string | null
          contact_email?: string | null
          created_at?: string
          dic?: string | null
          email?: string | null
          fee_min_cents?: number
          fee_percent?: number
          gopay_goid?: string | null
          iban?: string | null
          ic_dph?: string | null
          ico?: string | null
          id?: string
          name: string
          phone?: string | null
          slug: string
          status?: string
        }
        Update: {
          address?: string | null
          admin_notes?: string | null
          brand_color?: string | null
          brand_logo_url?: string | null
          contact_email?: string | null
          created_at?: string
          dic?: string | null
          email?: string | null
          fee_min_cents?: number
          fee_percent?: number
          gopay_goid?: string | null
          iban?: string | null
          ic_dph?: string | null
          ico?: string | null
          id?: string
          name?: string
          phone?: string | null
          slug?: string
          status?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          created_at: string
          gopay_payment_id: string
          id: string
          order_id: string | null
          raw: Json | null
          state: string
        }
        Insert: {
          created_at?: string
          gopay_payment_id: string
          id?: string
          order_id?: string | null
          raw?: Json | null
          state: string
        }
        Update: {
          created_at?: string
          gopay_payment_id?: string
          id?: string
          order_id?: string | null
          raw?: Json | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_requests: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          organizer_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organizer_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organizer_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      refund_jobs: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          id: string
          last_error: string | null
          max_attempts: number
          order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          gopay_refund_id: string | null
          id: string
          order_id: string
          reason: string | null
          status: string
          ticket_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          gopay_refund_id?: string | null
          id?: string
          order_id: string
          reason?: string | null
          status?: string
          ticket_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          gopay_refund_id?: string | null
          id?: string
          order_id?: string
          reason?: string | null
          status?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          created_by: string | null
          currency: string
          event_id: string | null
          fee_cents: number
          generated_at: string
          gross_cents: number
          id: string
          invoice_ref: string | null
          invoice_status: string
          invoiced_at: string | null
          kind: string
          net_cents: number
          order_count: number
          organizer_id: string
          period_end: string
          period_month: string | null
          period_start: string
          refunded_cents: number
          status: string
        }
        Insert: {
          created_by?: string | null
          currency?: string
          event_id?: string | null
          fee_cents?: number
          generated_at?: string
          gross_cents?: number
          id?: string
          invoice_ref?: string | null
          invoice_status?: string
          invoiced_at?: string | null
          kind?: string
          net_cents?: number
          order_count?: number
          organizer_id: string
          period_end: string
          period_month?: string | null
          period_start: string
          refunded_cents?: number
          status?: string
        }
        Update: {
          created_by?: string | null
          currency?: string
          event_id?: string | null
          fee_cents?: number
          generated_at?: string
          gross_cents?: number
          id?: string
          invoice_ref?: string | null
          invoice_status?: string
          invoiced_at?: string | null
          kind?: string
          net_cents?: number
          order_count?: number
          organizer_id?: string
          period_end?: string
          period_month?: string | null
          period_start?: string
          refunded_cents?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_answers: {
        Row: {
          created_at: string
          event_id: string | null
          field_key: string
          field_label: string
          id: string
          order_id: string | null
          ticket_id: string
          value: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          field_key: string
          field_label: string
          id?: string
          order_id?: string | null
          ticket_id: string
          value?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          field_key?: string
          field_label?: string
          id?: string
          order_id?: string | null
          ticket_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_answers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_answers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_answers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_types: {
        Row: {
          capacity: number
          created_at: string
          currency: string
          custom_fields: Json
          description: string | null
          event_id: string
          hidden: boolean
          id: string
          max_per_order: number
          name: string
          price_cents: number
          sale_ends_at: string | null
          sale_starts_at: string | null
          sold_count: number
          sort_order: number
        }
        Insert: {
          capacity: number
          created_at?: string
          currency?: string
          custom_fields?: Json
          description?: string | null
          event_id: string
          hidden?: boolean
          id?: string
          max_per_order?: number
          name: string
          price_cents: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold_count?: number
          sort_order?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          currency?: string
          custom_fields?: Json
          description?: string | null
          event_id?: string
          hidden?: boolean
          id?: string
          max_per_order?: number
          name?: string
          price_cents?: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold_count?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          checked_in_by: string | null
          created_at: string
          event_id: string
          holder_email: string | null
          holder_name: string | null
          id: string
          order_id: string | null
          source: string
          status: string
          ticket_type_id: string
          used_at: string | null
        }
        Insert: {
          checked_in_by?: string | null
          created_at?: string
          event_id: string
          holder_email?: string | null
          holder_name?: string | null
          id?: string
          order_id?: string | null
          source?: string
          status?: string
          ticket_type_id: string
          used_at?: string | null
        }
        Update: {
          checked_in_by?: string | null
          created_at?: string
          event_id?: string
          holder_email?: string | null
          holder_name?: string | null
          id?: string
          order_id?: string | null
          source?: string
          status?: string
          ticket_type_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          created_at: string
          email: string
          event_id: string
          id: string
          notified_at: string | null
          notify_expires_at: string | null
          status: string
          ticket_type_id: string
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          id?: string
          notified_at?: string | null
          notify_expires_at?: string | null
          status?: string
          ticket_type_id: string
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          id?: string
          notified_at?: string | null
          notify_expires_at?: string | null
          status?: string
          ticket_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event_type: string
          id: string
          last_error: string | null
          max_attempts: number
          payload: Json
          response_status: number | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event_type: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload: Json
          response_status?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          response_status?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          id: string
          organizer_id: string
          secret: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          organizer_id: string
          secret: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          organizer_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_search_orders: {
        Args: { p_q: string }
        Returns: {
          buyer_email: string
          buyer_name: string
          created_at: string
          event_id: string
          event_title: string
          id: string
          organizer_id: string
          organizer_name: string
          paid_at: string
          ref: string
          status: string
          total_cents: number
        }[]
      }
      generate_previous_month_settlements: { Args: never; Returns: number }
      generate_settlement_range: {
        Args: {
          p_created_by: string
          p_event_id: string
          p_from: string
          p_kind: string
          p_organizer: string
          p_to: string
        }
        Returns: string
      }
      generate_settlements: {
        Args: { p_period_month: string }
        Returns: number
      }
      increment_coupon_use: {
        Args: { p_coupon_id: string }
        Returns: undefined
      }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      organizer_is_active: { Args: { p_org: string }; Returns: boolean }
      recompute_settlement: { Args: { p_id: string }; Returns: number }
      release_expired_orders: { Args: never; Returns: number }
      release_ticket_capacity: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: undefined
      }
      reserve_ticket_capacity: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: boolean
      }
      schedule_reminder_jobs: { Args: never; Returns: number }
      trigger_email_processing: { Args: never; Returns: undefined }
      trigger_invoice_issuing: { Args: never; Returns: undefined }
      trigger_refund_processing: { Args: never; Returns: undefined }
      trigger_waitlist_processing: { Args: never; Returns: undefined }
      trigger_webhook_processing: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
