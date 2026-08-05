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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      api_connections: {
        Row: {
          active: boolean
          api_key_secret_name: string | null
          authentication_type: string
          base_url: string
          client_id_secret_name: string | null
          client_secret_secret_name: string | null
          created_at: string
          encrypted_credentials_reference: string
          environment: string
          id: string
          last_test_at: string | null
          last_test_duration_ms: number | null
          last_test_message: string | null
          last_test_ok: boolean | null
          last_test_status: number | null
          last_webhook_at: string | null
          name: string
          organization_id: string
          retry_count: number
          retry_interval_ms: number
          timeout_seconds: number
          token_secret_name: string | null
          updated_at: string
          webhook_secret_name: string | null
          webhook_signature_header: string
          webhook_signature_mode: string
        }
        Insert: {
          active?: boolean
          api_key_secret_name?: string | null
          authentication_type?: string
          base_url: string
          client_id_secret_name?: string | null
          client_secret_secret_name?: string | null
          created_at?: string
          encrypted_credentials_reference?: string
          environment?: string
          id?: string
          last_test_at?: string | null
          last_test_duration_ms?: number | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          last_test_status?: number | null
          last_webhook_at?: string | null
          name: string
          organization_id: string
          retry_count?: number
          retry_interval_ms?: number
          timeout_seconds?: number
          token_secret_name?: string | null
          updated_at?: string
          webhook_secret_name?: string | null
          webhook_signature_header?: string
          webhook_signature_mode?: string
        }
        Update: {
          active?: boolean
          api_key_secret_name?: string | null
          authentication_type?: string
          base_url?: string
          client_id_secret_name?: string | null
          client_secret_secret_name?: string | null
          created_at?: string
          encrypted_credentials_reference?: string
          environment?: string
          id?: string
          last_test_at?: string | null
          last_test_duration_ms?: number | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          last_test_status?: number | null
          last_webhook_at?: string | null
          name?: string
          organization_id?: string
          retry_count?: number
          retry_interval_ms?: number
          timeout_seconds?: number
          token_secret_name?: string | null
          updated_at?: string
          webhook_secret_name?: string | null
          webhook_signature_header?: string
          webhook_signature_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_endpoints: {
        Row: {
          active: boolean
          connection_id: string
          created_at: string
          description: string | null
          headers: Json
          id: string
          key: string
          method: string
          path: string
          request_mapping: Json
          response_mapping: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          connection_id: string
          created_at?: string
          description?: string | null
          headers?: Json
          id?: string
          key: string
          method?: string
          path: string
          request_mapping?: Json
          response_mapping?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          connection_id?: string
          created_at?: string
          description?: string | null
          headers?: Json
          id?: string
          key?: string
          method?: string
          path?: string
          request_mapping?: Json
          response_mapping?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_endpoints_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          app_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          new_data_json: Json
          old_data_json: Json
          organization_id: string | null
        }
        Insert: {
          action: string
          app_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_data_json?: Json
          old_data_json?: Json
          organization_id?: string | null
        }
        Update: {
          action?: string
          app_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_data_json?: Json
          old_data_json?: Json
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          cnpj: string
          created_at: string
          id: string
          metadata: Json
          nome_fantasia: string | null
          okton_company_id: string | null
          organization_id: string | null
          razao_social: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj: string
          created_at?: string
          id?: string
          metadata?: Json
          nome_fantasia?: string | null
          okton_company_id?: string | null
          organization_id?: string | null
          razao_social: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string
          created_at?: string
          id?: string
          metadata?: Json
          nome_fantasia?: string | null
          okton_company_id?: string | null
          organization_id?: string | null
          razao_social?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_app_user_id: string | null
          bot_paused: boolean
          company_cnpj: string | null
          current_flow_id: string | null
          current_step_id: string | null
          document_type: Database["public"]["Enums"]["doc_type"] | null
          external_conversation_id: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          last_interaction_at: string
          okton_branch_id: string | null
          okton_company_id: string | null
          organization_id: string
          phone_number: string
          provider: string
          started_at: string
          status: string
        }
        Insert: {
          assigned_app_user_id?: string | null
          bot_paused?: boolean
          company_cnpj?: string | null
          current_flow_id?: string | null
          current_step_id?: string | null
          document_type?: Database["public"]["Enums"]["doc_type"] | null
          external_conversation_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_interaction_at?: string
          okton_branch_id?: string | null
          okton_company_id?: string | null
          organization_id: string
          phone_number: string
          provider?: string
          started_at?: string
          status?: string
        }
        Update: {
          assigned_app_user_id?: string | null
          bot_paused?: boolean
          company_cnpj?: string | null
          current_flow_id?: string | null
          current_step_id?: string | null
          document_type?: Database["public"]["Enums"]["doc_type"] | null
          external_conversation_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_interaction_at?: string
          okton_branch_id?: string | null
          okton_company_id?: string | null
          organization_id?: string
          phone_number?: string
          provider?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_app_user_id_fkey"
            columns: ["assigned_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_current_flow_id_fkey"
            columns: ["current_flow_id"]
            isOneToOne: false
            referencedRelation: "flow_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          conversation_id: string | null
          created_at: string
          current_data_json: Json
          document_type: Database["public"]["Enums"]["doc_type"]
          expires_at: string
          id: string
          idempotency_key: string
          okton_draft_id: string | null
          organization_id: string
          status: Database["public"]["Enums"]["draft_status"]
          updated_at: string
          validation_result_json: Json
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          current_data_json?: Json
          document_type: Database["public"]["Enums"]["doc_type"]
          expires_at?: string
          id?: string
          idempotency_key?: string
          okton_draft_id?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["draft_status"]
          updated_at?: string
          validation_result_json?: Json
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          current_data_json?: Json
          document_type?: Database["public"]["Enums"]["doc_type"]
          expires_at?: string
          id?: string
          idempotency_key?: string
          okton_draft_id?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["draft_status"]
          updated_at?: string
          validation_result_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "drafts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      emissions: {
        Row: {
          access_key: string | null
          conversation_id: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["doc_type"]
          draft_id: string | null
          id: string
          idempotency_key: string
          okton_document_id: string | null
          organization_id: string
          pdf_url: string | null
          protocol: string | null
          rejection: Json | null
          request_payload: Json
          response_payload: Json
          status: Database["public"]["Enums"]["emission_status"]
          updated_at: string
          xml_url: string | null
        }
        Insert: {
          access_key?: string | null
          conversation_id?: string | null
          created_at?: string
          document_type: Database["public"]["Enums"]["doc_type"]
          draft_id?: string | null
          id?: string
          idempotency_key: string
          okton_document_id?: string | null
          organization_id: string
          pdf_url?: string | null
          protocol?: string | null
          rejection?: Json | null
          request_payload?: Json
          response_payload?: Json
          status?: Database["public"]["Enums"]["emission_status"]
          updated_at?: string
          xml_url?: string | null
        }
        Update: {
          access_key?: string | null
          conversation_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["doc_type"]
          draft_id?: string | null
          id?: string
          idempotency_key?: string
          okton_document_id?: string | null
          organization_id?: string
          pdf_url?: string | null
          protocol?: string | null
          rejection?: Json | null
          request_payload?: Json
          response_payload?: Json
          status?: Database["public"]["Enums"]["emission_status"]
          updated_at?: string
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emissions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emissions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_definitions: {
        Row: {
          active: boolean
          company_id: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["doc_type"]
          id: string
          initial_step_id: string | null
          name: string
          organization_id: string
          trigger_keywords: string[]
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          company_id?: string | null
          created_at?: string
          document_type: Database["public"]["Enums"]["doc_type"]
          id?: string
          initial_step_id?: string | null
          name: string
          organization_id: string
          trigger_keywords?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          company_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["doc_type"]
          id?: string
          initial_step_id?: string | null
          name?: string
          organization_id?: string
          trigger_keywords?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "flow_definitions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_definitions_initial_step_fkey"
            columns: ["initial_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_steps: {
        Row: {
          active: boolean
          configuration_json: Json
          created_at: string
          error_step_id: string | null
          field_key: string | null
          flow_id: string
          id: string
          key: string
          message_template: string
          name: string
          next_step_id: string | null
          order: number
          step_type: Database["public"]["Enums"]["flow_step_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          configuration_json?: Json
          created_at?: string
          error_step_id?: string | null
          field_key?: string | null
          flow_id: string
          id?: string
          key: string
          message_template?: string
          name: string
          next_step_id?: string | null
          order?: number
          step_type: Database["public"]["Enums"]["flow_step_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          configuration_json?: Json
          created_at?: string
          error_step_id?: string | null
          field_key?: string | null
          flow_id?: string
          id?: string
          key?: string
          message_template?: string
          name?: string
          next_step_id?: string | null
          order?: number
          step_type?: Database["public"]["Enums"]["flow_step_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_steps_error_step_id_fkey"
            columns: ["error_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_next_step_id_fkey"
            columns: ["next_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          conversation_id: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["doc_type"] | null
          duration_ms: number | null
          endpoint: string | null
          environment: string
          error_message: string | null
          id: string
          method: string | null
          okton_company_id: string | null
          organization_id: string | null
          phone_masked: string | null
          request_id: string | null
          request_summary_json: Json
          response_summary_json: Json
          service: string
          status_code: number | null
          success: boolean
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["doc_type"] | null
          duration_ms?: number | null
          endpoint?: string | null
          environment?: string
          error_message?: string | null
          id?: string
          method?: string | null
          okton_company_id?: string | null
          organization_id?: string | null
          phone_masked?: string | null
          request_id?: string | null
          request_summary_json?: Json
          response_summary_json?: Json
          service: string
          status_code?: number | null
          success?: boolean
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["doc_type"] | null
          duration_ms?: number | null
          endpoint?: string | null
          environment?: string
          error_message?: string | null
          id?: string
          method?: string | null
          okton_company_id?: string | null
          organization_id?: string | null
          phone_masked?: string | null
          request_id?: string | null
          request_summary_json?: Json
          response_summary_json?: Json
          service?: string
          status_code?: number | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          direction: string
          external_message_id: string | null
          id: string
          message_type: string
          processing_status: string
          received_at: string | null
          sent_at: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          direction: string
          external_message_id?: string | null
          id?: string
          message_type?: string
          processing_status?: string
          received_at?: string | null
          sent_at?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          message_type?: string
          processing_status?: string
          received_at?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          hits: number
          id: string
          organization_id: string | null
          scope: string
          subject: string
          updated_at: string
          window_start: string
        }
        Insert: {
          hits?: number
          id?: string
          organization_id?: string | null
          scope: string
          subject: string
          updated_at?: string
          window_start: string
        }
        Update: {
          hits?: number
          id?: string
          organization_id?: string | null
          scope?: string
          subject?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_hits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          error_message: string | null
          event_type: string | null
          external_event_id: string | null
          headers_json: Json
          id: string
          organization_id: string | null
          payload_json: Json
          processed_at: string | null
          processing_attempts: number
          processing_status: string
          provider: string
          received_at: string
        }
        Insert: {
          error_message?: string | null
          event_type?: string | null
          external_event_id?: string | null
          headers_json?: Json
          id?: string
          organization_id?: string | null
          payload_json?: Json
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          provider?: string
          received_at?: string
        }
        Update: {
          error_message?: string | null
          event_type?: string | null
          external_event_id?: string | null
          headers_json?: Json
          id?: string
          organization_id?: string | null
          payload_json?: Json
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          provider?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_channels: {
        Row: {
          active: boolean
          base_url: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          environment: string
          id: string
          instance_name: string
          last_event_at: string | null
          organization_id: string | null
          payload_mapping: Json
          phone_number: string | null
          provider: string
          send_token_secret_name: string | null
          send_url: string | null
          signature_header: string
          signature_mode: string
          status: string
          updated_at: string
          webhook_secret_name: string | null
          webhook_token: string
        }
        Insert: {
          active?: boolean
          base_url?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          id?: string
          instance_name: string
          last_event_at?: string | null
          organization_id?: string | null
          payload_mapping?: Json
          phone_number?: string | null
          provider?: string
          send_token_secret_name?: string | null
          send_url?: string | null
          signature_header?: string
          signature_mode?: string
          status?: string
          updated_at?: string
          webhook_secret_name?: string | null
          webhook_token?: string
        }
        Update: {
          active?: boolean
          base_url?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          id?: string
          instance_name?: string
          last_event_at?: string | null
          organization_id?: string | null
          payload_mapping?: Json
          phone_number?: string | null
          provider?: string
          send_token_secret_name?: string | null
          send_url?: string | null
          signature_header?: string
          signature_mode?: string
          status?: string
          updated_at?: string
          webhook_secret_name?: string | null
          webhook_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_channels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_configure: { Args: never; Returns: boolean }
      can_operate: { Args: never; Returns: boolean }
      current_org: { Args: never; Returns: string }
      current_role_name: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      expire_stale_drafts: { Args: never; Returns: number }
      has_any_role: {
        Args: { _roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      register_rate_limit_hit: {
        Args: {
          _organization_id?: string
          _scope: string
          _subject: string
          _window_seconds: number
        }
        Returns: number
      }
      seed_default_flows: { Args: { _org: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "gestor" | "operador" | "auditor" | "suporte"
      doc_type: "nfe" | "cte" | "mdfe"
      draft_status:
        | "collecting"
        | "validating"
        | "awaiting_confirmation"
        | "confirmed"
        | "discarded"
      emission_status:
        | "pending"
        | "sent"
        | "authorized"
        | "rejected"
        | "error"
        | "cancelled"
      flow_step_type:
        | "message"
        | "collect_value"
        | "select_option"
        | "identify_company"
        | "select_branch"
        | "select_document"
        | "load_required_fields"
        | "select_input_mode"
        | "collect_dynamic_fields"
        | "validate_field"
        | "show_summary"
        | "request_confirmation"
        | "send_emission"
        | "wait_status"
        | "send_files"
        | "transfer_to_human"
        | "finish"
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
    Enums: {
      app_role: ["admin", "gestor", "operador", "auditor", "suporte"],
      doc_type: ["nfe", "cte", "mdfe"],
      draft_status: [
        "collecting",
        "validating",
        "awaiting_confirmation",
        "confirmed",
        "discarded",
      ],
      emission_status: [
        "pending",
        "sent",
        "authorized",
        "rejected",
        "error",
        "cancelled",
      ],
      flow_step_type: [
        "message",
        "collect_value",
        "select_option",
        "identify_company",
        "select_branch",
        "select_document",
        "load_required_fields",
        "select_input_mode",
        "collect_dynamic_fields",
        "validate_field",
        "show_summary",
        "request_confirmation",
        "send_emission",
        "wait_status",
        "send_files",
        "transfer_to_human",
        "finish",
      ],
    },
  },
} as const
