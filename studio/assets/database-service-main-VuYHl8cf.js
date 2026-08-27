import{i as e,n as t,r as n,t as r}from"./logger-BUo2gG75.js";import{A as i,C as a,D as o,E as s,I as c,L as l,O as u,R as d,S as f,T as ee,_ as te,a as p,b as ne,c as m,d as re,f as h,g,h as _,i as v,k as ie,l as y,m as ae,n as b,o as x,p as oe,r as S,s as C,t as w,u as se,v as ce,w as le,x as ue,y as de,z as T}from"./schema-DpSduDpW.js";import{n as E,r as D,t as O}from"./database-service-core--NHr1xgP.js";import{t as k}from"./thread-history-search-vector-B_NWWCjC.js";import{x as A}from"./chunk-E4Q7R6FO-69edTocI.js";A();var j={name:`uuid-ossp`,setup:async(e,t)=>({bundlePath:new URL(`/memorall/studio/assets/uuid-ossp.tar-B_ARvRrM.gz`,``+import.meta.url)})};A();var M={name:`pgvector`,setup:async(e,t)=>({emscriptenOpts:t,bundlePath:new URL(`/memorall/studio/assets/vector.tar-B6mD7VLQ.gz`,``+import.meta.url)})};A();var N={name:`pg_trgm`,setup:async(e,t)=>({bundlePath:new URL(`/memorall/studio/assets/pg_trgm.tar-3zayjqji.gz`,``+import.meta.url)})};function P(e){return e[Symbol.for(`drizzle:Name`)]}function F(e){return e[Symbol.for(`drizzle:Columns`)]}function I(e){return e[Symbol.for(`drizzle:ExtraConfigBuilder`)]}function L(t){try{let e=P(t),n=F(t),r=[],i=[];for(let[e,t]of Object.entries(n)){let n=t,a=n.name||e,o=`${a} `,s=n.columnType;switch(s){case`PgUUID`:o+=`UUID`;break;case`PgText`:o+=`TEXT`;break;case`PgTimestamp`:o+=`TIMESTAMP`;break;case`PgJsonb`:o+=`JSONB`;break;case`PgReal`:o+=`REAL`;break;case`PgInteger`:o+=`INTEGER`;break;case`PgSerial`:o+=`SERIAL`;break;case`PgBigSerial`:o+=`BIGSERIAL`;break;case`PgBoolean`:o+=`BOOLEAN`;break;case`PgVarchar`:let e=n.size;o+=e?`VARCHAR(${e})`:`VARCHAR`;break;case`PgVector`:let t=n.dimensions||768;o+=`VECTOR(${t})`;break;default:o+=`TEXT`}n.primary&&(o+=` PRIMARY KEY`),n.notNull&&(o+=` NOT NULL`);let c=n.default,l=n.hasDefault,u=n.generated?.type===`always`||n.autoIncrement,d=!1,f=!1;if(l&&c){if(typeof c==`object`&&c){let e=c;if(e.sql&&typeof e.sql==`object`){let t=e.sql,n=String(t.sql||``);d=n.includes(`gen_random_uuid`)||n.includes(`uuid_generate_v4`),f=n.includes(`now()`)||n.includes(`NOW()`)||n.includes(`CURRENT_TIMESTAMP`)}let t=String(c);!d&&!f&&(d=t.includes(`defaultRandom`)||t.includes(`gen_random_uuid`)||t.includes(`random`),f=t.includes(`defaultNow`)||t.includes(`NOW`)||t.includes(`now`))}else if(typeof c==`function`){let e=c.toString();d=e.includes(`gen_random_uuid`)||e.includes(`defaultRandom`),f=e.includes(`now`)||e.includes(`defaultNow`)||e.includes(`NOW`)}else{let e=String(c);d=e.includes(`defaultRandom`)||e.includes(`gen_random_uuid`)||e.includes(`random`),f=e.includes(`defaultNow`)||e.includes(`NOW`)||e.includes(`now`)}}if(s===`PgUUID`&&n.primary&&!d&&(d=!0),s===`PgTimestamp`&&(a.includes(`created`)||a.includes(`updated`))&&(f=!0),d&&s===`PgUUID`)o+=` DEFAULT gen_random_uuid()`;else if(f&&s===`PgTimestamp`)o+=` DEFAULT NOW()`;else if(u&&(s===`PgInteger`||s===`PgSerial`))s===`PgInteger`&&(o=o.replace(`INTEGER`,`SERIAL`));else if(c!==void 0){if(typeof c==`function`){let e=c.toString();e.includes(`gen_random_uuid`)||e.includes(`defaultRandom`)?o+=` DEFAULT gen_random_uuid()`:(e.includes(`now`)||e.includes(`defaultNow`))&&(o+=` DEFAULT NOW()`)}else s===`PgJsonb`&&typeof c==`object`?o+=` DEFAULT '${JSON.stringify(c)}'`:typeof c==`string`?o+=` DEFAULT '${c}'`:(typeof c==`boolean`||typeof c==`number`)&&(o+=` DEFAULT ${c}`)}if(n.references&&typeof n.references==`function`)try{let e=n.references(),t=P(e.table),r=e.name;t&&r&&i.push(`FOREIGN KEY (${a}) REFERENCES ${t}(${r})`)}catch{}r.push(o)}return`CREATE TABLE IF NOT EXISTS ${e} (\n  ${[...r,...i].join(`,
  `)}\n);`}catch(t){return e(`Failed to generate CREATE TABLE SQL:`,t),`-- Failed to generate table SQL`}}function R(e){try{let t=P(e),n=I(e);if(!n)return[];let r=F(e),i={};for(let[e,t]of Object.entries(r))i[e]={name:t.name||e};return n(i).map(e=>{try{let n=e.config,r=n?.name||`${t}_${Date.now()}_idx`,i=(n?.columns)?.map(e=>e.name).filter(Boolean).join(`, `);return i?`CREATE INDEX IF NOT EXISTS ${r} ON ${t}(${i});`:``}catch{return``}}).filter(Boolean)}catch{return[]}}function z(e){return{table:L(e),indexes:R(e)}}var B=async e=>{let t=z(c),n=z(o),r=z(ie),d=z(ee),p=z(f),m=z(de),v=z(te),y=z(_),b=z(oe),x=z(re),S=`
    -- Enable extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    CREATE OR REPLACE FUNCTION set_created_updated_timestamps()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.created_at IS NULL THEN
        NEW.created_at = CURRENT_TIMESTAMP;
      END IF;
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    ${t.table}
    ${t.indexes.join(`
`)}

    ${n.table}
    ${n.indexes.join(`
`)}

    ${r.table}
    ${r.indexes.join(`
`)}

    ${d.table}
    ${d.indexes.join(`
`)}

    ${p.table}
    ${p.indexes.join(`
`)}

    ${m.table}
    ${m.indexes.join(`
`)}

    ${v.table}
    ${v.indexes.join(`
`)}

    ${y.table}
    ${y.indexes.join(`
`)}

    ${b.table}
    ${b.indexes.join(`
`)}

    ${x.table}
    ${x.indexes.join(`
`)}

    ${a.join(`
`)}
    ${ne.join(`
`)}

    ${h.join(`
`)}
    ${l.join(`
`)}
    ${ue.join(`
`)}
    ${ae.join(`
`)}
    ${u.join(`
`)}
    ${le.join(`
`)}
    ${g.join(`
`)}
    ${ce.join(`
`)}
    ${s.join(`
`)}
    ${i.join(`
`)}

    -- SQL Functions for trigram search
    CREATE OR REPLACE FUNCTION search_nodes_trigram(
      search_text TEXT,
      similarity_threshold REAL DEFAULT 0.1,
      result_limit INTEGER DEFAULT 50
    )
    RETURNS TABLE(
      id UUID,
      node_type TEXT,
      name TEXT,
      summary TEXT,
      attributes JSONB,
      graph TEXT,
      name_embedding VECTOR(768),
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      similarity_score REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        n.id,
        n.node_type,
        n.name,
        n.summary,
        n.attributes,
        n.graph,
        n.name_embedding,
        n.created_at,
        n.updated_at,
        GREATEST(
          COALESCE(similarity(n.name, search_text), 0),
          COALESCE(similarity(COALESCE(n.summary, ''), search_text), 0)
        ) as similarity_score
      FROM nodes n
      WHERE (
        similarity(n.name, search_text) > similarity_threshold
        OR similarity(COALESCE(n.summary, ''), search_text) > similarity_threshold
      )
      ORDER BY similarity_score DESC
      LIMIT result_limit;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION search_edges_trigram(
      search_text TEXT,
      similarity_threshold REAL DEFAULT 0.1,
      result_limit INTEGER DEFAULT 50
    )
    RETURNS TABLE(
      id UUID,
      source_id UUID,
      destination_id UUID,
      edge_type TEXT,
      fact_text TEXT,
      valid_at TIMESTAMP,
      invalid_at TIMESTAMP,
      recorded_at TIMESTAMP,
      attributes JSONB,
      graph TEXT,
      is_current BOOLEAN,
      provenance_weight_cache REAL,
      provenance_count_cache INTEGER,
      fact_embedding VECTOR(768),
      type_embedding VECTOR(768),
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      similarity_score REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        e.id,
        e.source_id,
        e.destination_id,
        e.edge_type,
        e.fact_text,
        e.valid_at,
        e.invalid_at,
        e.recorded_at,
        e.attributes,
        e.graph,
        e.is_current,
        e.provenance_weight_cache,
        e.provenance_count_cache,
        e.fact_embedding,
        e.type_embedding,
        e.created_at,
        e.updated_at,
        GREATEST(
          COALESCE(similarity(COALESCE(e.fact_text, ''), search_text), 0),
          COALESCE(similarity(e.edge_type, search_text), 0)
        ) as similarity_score
      FROM edges e
      WHERE (
        similarity(COALESCE(e.fact_text, ''), search_text) > similarity_threshold
        OR similarity(e.edge_type, search_text) > similarity_threshold
      )
      ORDER BY similarity_score DESC
      LIMIT result_limit;
    END;
    $$ LANGUAGE plpgsql;
  `;await e.exec(S)},V=async e=>{let t=z(se),n=`
    -- Create topic_files table
    ${t.table}
    ${t.indexes.join(`
`)}
  `;await e.exec(n)},H=async e=>{await e.exec(`
    DROP TABLE IF EXISTS topic_files CASCADE;
  `)},fe=async e=>{let t=z(y),n=z(m),r=`
    -- Create activity_sessions table
    ${t.table}
    ${t.indexes.join(`
`)}

    -- Create activities table
    ${n.table}
    ${n.indexes.join(`
`)}

    -- Create indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_activities_session_id ON activities(session_id);
    CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
    CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_sessions_status ON activity_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_activity_sessions_start_time ON activity_sessions(start_time);
  `;await e.exec(r)},pe=async e=>{await e.exec(`
    DROP TABLE IF EXISTS activities CASCADE;
    DROP TABLE IF NOT EXISTS activity_sessions CASCADE;
  `)},me=async e=>{await e.exec(`
    -- Add display_meta column to activities table
    ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS display_meta JSONB;

    -- Add index for faster queries on display_meta
    CREATE INDEX IF NOT EXISTS idx_activities_display_meta ON activities USING gin(display_meta);
  `)},he=async e=>{await e.exec(`
    -- Remove display_meta column
    ALTER TABLE activities DROP COLUMN IF EXISTS display_meta;
  `)},ge=async e=>{await e.exec(`
    -- Add small and large embedding columns to nodes table
    ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS name_embedding_small vector(384),
    ADD COLUMN IF NOT EXISTS name_embedding_large vector(1536);

    -- Add small and large embedding columns to edges table
    ALTER TABLE edges
    ADD COLUMN IF NOT EXISTS fact_embedding_small vector(384),
    ADD COLUMN IF NOT EXISTS fact_embedding_large vector(1536),
    ADD COLUMN IF NOT EXISTS type_embedding_small vector(384),
    ADD COLUMN IF NOT EXISTS type_embedding_large vector(1536);

    -- Add small and large embedding columns to messages table
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS embedding_small vector(384),
    ADD COLUMN IF NOT EXISTS embedding_large vector(1536);
  `)},_e=async e=>{await e.exec(`
    -- Remove small and large embedding columns from nodes table
    ALTER TABLE nodes
    DROP COLUMN IF EXISTS name_embedding_small,
    DROP COLUMN IF EXISTS name_embedding_large;

    -- Remove small and large embedding columns from edges table
    ALTER TABLE edges
    DROP COLUMN IF EXISTS fact_embedding_small,
    DROP COLUMN IF EXISTS fact_embedding_large,
    DROP COLUMN IF EXISTS type_embedding_small,
    DROP COLUMN IF EXISTS type_embedding_large;

    -- Remove small and large embedding columns from messages table
    ALTER TABLE messages
    DROP COLUMN IF EXISTS embedding_small,
    DROP COLUMN IF EXISTS embedding_large;
  `)},ve=async e=>{let t=z(d),n=z(C),r=z(x),i=z(p),a=z(v),o=`
    -- Create flows table
    ${t.table}
    ${t.indexes.join(`
`)}

    -- Create flow_states table
    ${n.table}
    ${n.indexes.join(`
`)}

    -- Create flow_services table (static catalog)
    ${r.table}
    ${r.indexes.join(`
`)}

    -- Create flow_steps table (static catalog)
    ${i.table}
    ${i.indexes.join(`
`)}

    -- Create flow_connections table
    ${a.table}
    ${a.indexes.join(`
`)}
  `;await e.exec(o)},U=async e=>{await e.exec(`
    DROP TABLE IF EXISTS flow_connections CASCADE;
    DROP TABLE IF EXISTS flow_steps CASCADE;
    DROP TABLE IF EXISTS flow_services CASCADE;
    DROP TABLE IF EXISTS flow_states CASCADE;
    DROP TABLE IF EXISTS flows CASCADE;
  `)},ye=async e=>{await e.exec(`
		ALTER TABLE flows ADD COLUMN IF NOT EXISTS predefined_flow TEXT;
		CREATE INDEX IF NOT EXISTS flows_predefined_flow_idx ON flows (predefined_flow);
	`);let t=z(b);await e.exec(`
		${t.table}
		${t.indexes.join(`
`)}
	`);for(let t of S)await e.exec(t)},be=async e=>{await e.exec(`
		DROP TABLE IF EXISTS flow_configs CASCADE;
		ALTER TABLE flows DROP COLUMN IF EXISTS predefined_flow;
		DROP INDEX IF EXISTS flows_predefined_flow_idx;
	`)},xe=async e=>{await e.exec(`
		CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
			ON messages (conversation_id, created_at);

		CREATE INDEX IF NOT EXISTS messages_conversation_type_created_idx
			ON messages (conversation_id, type, created_at);
	`)},Se=async e=>{await e.exec(`
		DROP INDEX IF EXISTS messages_conversation_created_idx;
		DROP INDEX IF EXISTS messages_conversation_type_created_idx;
	`)},Ce=async e=>{await e.exec(`
		ALTER TABLE topics
			ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES flows(id) ON DELETE SET NULL;

		CREATE INDEX IF NOT EXISTS topics_agent_id_idx ON topics (agent_id);
	`)},we=async e=>{await e.exec(`
		DROP INDEX IF EXISTS topics_agent_id_idx;
		ALTER TABLE topics DROP COLUMN IF EXISTS agent_id;
	`)},Te=async e=>{await e.exec(`
		ALTER TABLE topics
			ADD COLUMN IF NOT EXISTS grow_type  TEXT NOT NULL DEFAULT 'knowledge-graph',
			ADD COLUMN IF NOT EXISTS recall_type TEXT NOT NULL DEFAULT 'smart';
	`)},Ee=async e=>{await e.exec(`
		ALTER TABLE topics
			DROP COLUMN IF EXISTS grow_type,
			DROP COLUMN IF EXISTS recall_type;
	`)},De=async e=>{await e.exec(`
		ALTER TABLE conversations
			ADD COLUMN IF NOT EXISTS name TEXT,
			ADD COLUMN IF NOT EXISTS agent_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL;

		UPDATE conversations
			SET name = COALESCE(name, title)
			WHERE name IS NULL;

		CREATE INDEX IF NOT EXISTS conversations_agent_flow_id_idx
			ON conversations (agent_flow_id);

		CREATE TABLE IF NOT EXISTS cron_jobs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft',
			schedule_expression TEXT NOT NULL,
			timezone TEXT NOT NULL,
			action_type TEXT NOT NULL DEFAULT 'agent_chat',
			action_payload JSONB NOT NULL DEFAULT '{}',
			agent_flow_id UUID REFERENCES flows(id) ON DELETE CASCADE,
			conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
			allow_overlap BOOLEAN NOT NULL DEFAULT false,
			last_run_at TIMESTAMP,
			next_run_at TIMESTAMP,
			last_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			run_count INTEGER NOT NULL DEFAULT 0,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMP DEFAULT NOW() NOT NULL,
			updated_at TIMESTAMP DEFAULT NOW() NOT NULL
		);

		CREATE INDEX IF NOT EXISTS cron_jobs_status_next_run_at_idx
			ON cron_jobs (status, next_run_at);
		CREATE INDEX IF NOT EXISTS cron_jobs_agent_flow_id_idx
			ON cron_jobs (agent_flow_id);
		CREATE INDEX IF NOT EXISTS cron_jobs_conversation_id_idx
			ON cron_jobs (conversation_id);

		CREATE OR REPLACE FUNCTION update_cron_jobs_updated_at()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = NOW();
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		DROP TRIGGER IF EXISTS cron_jobs_updated_at_trigger ON cron_jobs;
		CREATE TRIGGER cron_jobs_updated_at_trigger
			BEFORE UPDATE ON cron_jobs
			FOR EACH ROW
			EXECUTE FUNCTION update_cron_jobs_updated_at();
	`)},Oe=async e=>{await e.exec(`
		DROP TRIGGER IF EXISTS cron_jobs_updated_at_trigger ON cron_jobs;
		DROP FUNCTION IF EXISTS update_cron_jobs_updated_at();
		DROP TABLE IF EXISTS cron_jobs CASCADE;
		DROP INDEX IF EXISTS conversations_agent_flow_id_idx;
		ALTER TABLE conversations
			DROP COLUMN IF EXISTS agent_flow_id,
			DROP COLUMN IF EXISTS name;
	`)},ke=async e=>{await e.exec(`
		UPDATE flows
		SET predefined_flow = 'foundation'
		WHERE predefined_flow = 'knowledge-rag';

		UPDATE flow_configs
		SET value = '"foundation"'::jsonb,
			updated_at = NOW()
		WHERE name = 'graphType'
			AND value = '"knowledge-rag"'::jsonb;

		UPDATE flow_configs
		SET value = jsonb_set(value, '{graphType}', '"foundation"'::jsonb, true),
			updated_at = NOW()
		WHERE name = 'unified_config'
			AND type = 'object'
			AND value->>'graphType' = 'knowledge-rag';

		UPDATE flow_configs
		SET value = jsonb_set(
				value,
				'{steps}',
				(
					SELECT jsonb_agg(
						CASE
							WHEN step->>'id' LIKE 'knowledge-rag__%'
								THEN jsonb_set(
									step,
									'{id}',
									to_jsonb(replace(step->>'id', 'knowledge-rag__', 'foundation__')),
									false
								)
							ELSE step
						END
						ORDER BY ordinality
					)
					FROM jsonb_array_elements(value->'steps') WITH ORDINALITY AS items(step, ordinality)
				),
				false
			),
			updated_at = NOW()
		WHERE name = 'unified_config'
			AND type = 'object'
			AND jsonb_typeof(value->'steps') = 'array'
			AND EXISTS (
				SELECT 1
				FROM jsonb_array_elements(value->'steps') AS items(step)
				WHERE step->>'id' LIKE 'knowledge-rag__%'
			);
	`)},Ae=async e=>{await e.exec(`
		UPDATE flows
		SET predefined_flow = 'knowledge-rag'
		WHERE predefined_flow = 'foundation';

		UPDATE flow_configs
		SET value = '"knowledge-rag"'::jsonb,
			updated_at = NOW()
		WHERE name = 'graphType'
			AND value = '"foundation"'::jsonb;

		UPDATE flow_configs
		SET value = jsonb_set(value, '{graphType}', '"knowledge-rag"'::jsonb, true),
			updated_at = NOW()
		WHERE name = 'unified_config'
			AND type = 'object'
			AND value->>'graphType' = 'foundation';

		UPDATE flow_configs
		SET value = jsonb_set(
				value,
				'{steps}',
				(
					SELECT jsonb_agg(
						CASE
							WHEN step->>'id' LIKE 'foundation__%'
								THEN jsonb_set(
									step,
									'{id}',
									to_jsonb(replace(step->>'id', 'foundation__', 'knowledge-rag__')),
									false
								)
							ELSE step
						END
						ORDER BY ordinality
					)
					FROM jsonb_array_elements(value->'steps') WITH ORDINALITY AS items(step, ordinality)
				),
				false
			),
			updated_at = NOW()
		WHERE name = 'unified_config'
			AND type = 'object'
			AND jsonb_typeof(value->'steps') = 'array'
			AND EXISTS (
				SELECT 1
				FROM jsonb_array_elements(value->'steps') AS items(step)
				WHERE step->>'id' LIKE 'foundation__%'
			);
	`)},je=async e=>{await e.exec(`
		ALTER TABLE messages
		ADD COLUMN IF NOT EXISTS parts JSONB;
	`)},Me=async e=>{await e.exec(`
		ALTER TABLE messages
		DROP COLUMN IF EXISTS parts;
	`)},W=async e=>{await e.exec(`
		CREATE INDEX IF NOT EXISTS messages_thread_history_search_idx
			ON messages USING gin (
				${k()}
			);
	`)},G=[{id:`initial`,version:1,description:`Initial schema with knowledge graph, conversations, and trigram search`,up:B},{id:`add_topic_files`,version:2,description:`Add topic_files table for linking files to topics`,up:V,down:H},{id:`add_activity_tracking`,version:3,description:`Add activity_sessions and activities tables for activity tracking`,up:fe,down:pe},{id:`add_display_meta`,version:4,description:`Add display_meta column to activities table for user-friendly rendering`,up:me,down:he},{id:`add_multi_size_embeddings`,version:5,description:`Add multi-size embedding support (small 384d, medium 768d, large 1536d)`,up:ge,down:_e},{id:`add_flow_builder`,version:6,description:`Add flow builder tables (flows, flow_states, flow_services, flow_steps, flow_connections)`,up:ve,down:U},{id:`add_predefined_flow_and_flow_configs`,version:7,description:`Add predefined_flow column to flows and flow_configs table`,up:ye,down:be},{id:`add_message_query_indexes`,version:8,description:`Add conversation/time indexes for separator-first message loading`,up:xe,down:Se},{id:`add_agent_id_to_topics`,version:9,description:`Add agent_id to topics for linking memory zones to agents (nullable — independent topics remain unlinked)`,up:Ce,down:we},{id:`add_grow_recall_type_to_topics`,version:10,description:`Add grow_type and recall_type to topics — grow_type is immutable (knowledge-graph|structmem), recall_type is mutable per-memory retrieval strategy`,up:Te,down:Ee},{id:`add_cron_jobs`,version:11,description:`Add durable agent cron jobs and link conversations to agents`,up:De,down:Oe},{id:`rename_knowledge_rag_to_foundation`,version:12,description:`Rename predefined knowledge RAG flow records to foundation`,up:ke,down:Ae},{id:`add_message_parts`,version:13,description:`Add message parts column for canonical role-based message records`,up:je,down:Me},{id:`add_message_history_search_index`,version:14,description:`Add full-text index for separator-scoped thread history search`,up:W,down:async e=>{await e.exec(`
		DROP INDEX IF EXISTS messages_thread_history_search_idx;
	`)}},{id:`bound_message_history_search_index`,version:15,description:`Bound thread history tsvector size for large AI2UI messages`,up:async e=>{await e.exec(`DROP INDEX IF EXISTS messages_thread_history_search_idx;`),await W(e)},down:async e=>{await e.exec(`DROP INDEX IF EXISTS messages_thread_history_search_idx;`)}}];G.reduce((e,t)=>(e[t.id]=t,e),{});async function Ne(e){await e.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      description TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `)}async function Pe(e){return(await e.query(`
    SELECT id FROM _migrations
    ORDER BY version ASC
  `)).rows.map(e=>typeof e==`object`&&e&&`id`in e?`${e.id}`:``)}async function Fe(e,t){await e.query(`
    INSERT INTO _migrations (id, version, description)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO NOTHING
  `,[t.id,t.version,t.description])}async function Ie(e){await Ne(e);let n=await Pe(e);for(let i of G)if(n.includes(i.id))r(`⏭️ Migration ${i.id} already applied`);else{r(`Running migration: ${i.id} - ${i.description}`);try{await i.up(e),await Fe(e,i),r(`✅ Migration ${i.id} completed successfully`)}catch(e){throw t(`❌ Migration ${i.id} failed:`,e),e}}}var K=null,q=null,J=null;async function Le(e){if(q)return q;try{let t=typeof e==`string`?{mode:T.MAIN,dataDir:e}:e||{mode:T.MAIN};if(J=t.mode,t.mode===T.MAIN){let e=new D(t.dataDir||`idb://memorall-db`,{extensions:{vector:M,uuid_ossp:j,pg_trgm:N}});await e.waitReady,K=e,await Ie(e),n(`✅ Database initialized in MAIN mode`)}else throw Error(`PROXY mode should not initialize database here. Use DatabaseServiceProxy instead.`);return q=E(K,{schema:w}),n(`✅ Database initialized successfully in ${t.mode.toUpperCase()} mode`),q}catch(e){throw t(`❌ Database initialization failed:`,e),e}}function Re(){if(!q)throw Error(`Database not initialized. Call initDB() first.`);return q}function ze(){if(!K)throw Error(`Database not initialized. Call initDB() first.`);return K}function Y(){return J}function X(){return J===T.MAIN}function Z(){return J===T.PROXY}async function Q(){try{return K?{healthy:!0,test:(await K.query(`SELECT 1 as test`)).rows[0],mode:J}:{healthy:!1,error:`Database not initialized`}}catch(e){return{healthy:!1,error:e instanceof Error?e.message:`Unknown error`,mode:J}}}async function Be(){K&&(await K.close(),K=null,q=null,J=null)}var Ve={startListening:()=>void 0,stop:()=>void 0};function $(){return Ve}var He=class extends O{async initializeDatabase(){n(`📚 Initializing database service in "MAIN" mode. Channel: "${this.config.proxyOptions?.channelName}"`);try{await Le(this.config);let e=this.config.proxyOptions?.channelName;e&&$().startListening(e),n(`✅ Database service initialized successfully`)}catch(e){throw t(`❌ Database service initialization failed:`,e),e}}hasTable(e){return e in w}getTableNames(){return Object.keys(w)}async getStatus(){let e={initialized:this.initialized,mode:Y(),isMainMode:X(),isProxyMode:Z(),tableCount:Object.keys(w).length,availableTables:this.getTableNames(),healthy:!1,healthCheck:null};if(this.initialized)try{e.healthCheck=await Q(),e.healthy=e.healthCheck.healthy}catch(t){e.healthCheck={healthy:!1,error:t instanceof Error?t.message:`Unknown error`}}return e}getMode(){return Y()}isMainMode(){return X()}isProxyMode(){return Z()}async healthCheck(){try{return await this.ensureInitialized(),(await Q()).healthy}catch(e){return t(`❌ Database health check failed:`,e),!1}}async close(){this.config?.mode===T.MAIN&&this.config.proxyOptions?.channelName&&($().stop(),n(`📡 RPC handler stopped`)),await Be(),this.initialized=!1,this.initPromise=null,this.config=null,n(`📚 Database service closed`)}async use(e,t){await this.ensureInitialized();let n=Re(),r=ze(),i={db:n,schema:w,raw:(e,t)=>r.query(e,t)};return t?.transaction?n.transaction(async t=>e({db:t,schema:w,raw:(e,t)=>r.query(e,t)})):e(i)}};export{He as DatabaseServiceMain};