-- SoftPulse realistic demo dataset: 3 projects, 8 scans and 40 modules.
-- Apply after the first account has registered so the sample workspace has an owner.
do $seed$
declare
  v_owner uuid;
  v_project uuid;
  v_scan_id uuid;
  v_module_id uuid;
  v_scan record;
  v_i integer;
  v_module_paths text[] := array[
    'src/validation/schema.ts',
    'src/formatters/date.ts',
    'src/transform/mapper.ts',
    'src/services/payment.ts',
    'src/components/LegacyTable.tsx'
  ];
  v_metric_keys text[] := array[
    'lines_of_code','cyclomatic_complexity','maintainability_index','duplication_pct',
    'code_smells','comment_ratio','function_length','nesting_depth','test_coverage_pct',
    'test_to_code_ratio','outdated_dependencies','vulnerable_dependencies'
  ];
  v_raw_values numeric[] := array[12400,7.4,86,3.8,24,8.2,32,3,78,0.22,5,2];
  v_norm_values numeric[] := array[74,81,86,88,78,72,80,75,78,69,65,55];
  v_weights numeric[] := array[0.04,0.12,0.14,0.10,0.10,0.04,0.08,0.08,0.12,0.06,0.06,0.06];
begin
  select user_id into v_owner
  from public.user_roles
  order by created_at asc
  limit 1;

  if v_owner is null then
    raise notice 'No registered user found. Run this seed after the first user signs up.';
    return;
  end if;

  insert into public.projects(owner_id,name,repo_url,repo_owner,repo_name,default_branch)
  values
    (v_owner,'commons-utils','https://github.com/acme/commons-utils','acme','commons-utils','main'),
    (v_owner,'payments-api','https://github.com/acme/payments-api','acme','payments-api','main'),
    (v_owner,'customer-portal','https://github.com/acme/customer-portal','acme','customer-portal','develop')
  on conflict (owner_id,repo_url) do nothing;

  for v_scan in
    select * from (values
      ('https://github.com/acme/commons-utils',91,'A','a81c29d','Refactor shared validation utilities','Maya Chen',0),
      ('https://github.com/acme/payments-api',78,'B','f2b711a','Add payment retry handling','Arjun Rao',0),
      ('https://github.com/acme/commons-utils',87,'B','c87d142','Improve error boundaries','Maya Chen',1),
      ('https://github.com/acme/customer-portal',64,'C','9a71e52','Update account settings flow','Nina Patel',1),
      ('https://github.com/acme/payments-api',76,'B','bd82f61','Add transaction audit events','Arjun Rao',2),
      ('https://github.com/acme/commons-utils',84,'B','1dc803e','Reduce duplicate formatting logic','Maya Chen',3),
      ('https://github.com/acme/customer-portal',67,'C','2c04a6e','Resolve navigation regression','Nina Patel',4),
      ('https://github.com/acme/payments-api',72,'B','e45d01b','Introduce service layer','Arjun Rao',5)
    ) as scans(repo_url,score,grade,sha,message,author,days_ago)
  loop
    select id into v_project from public.projects
    where owner_id = v_owner and repo_url = v_scan.repo_url
    limit 1;

    if not exists (
      select 1 from public.scans
      where project_id = v_project and commit_sha = v_scan.sha
    ) then
      insert into public.scans(
        project_id,started_by,status,progress,current_stage,health_score,grade,
        commit_sha,commit_message,commit_author,started_at,completed_at,created_at
      ) values (
        v_project,v_owner,'completed',100,'Report',v_scan.score,v_scan.grade,
        v_scan.sha,v_scan.message,v_scan.author,
        now() - make_interval(days => v_scan.days_ago) - interval '12 minutes',
        now() - make_interval(days => v_scan.days_ago) - interval '10 minutes',
        now() - make_interval(days => v_scan.days_ago)
      ) returning id into v_scan_id;

      for v_i in 1..5 loop
        insert into public.modules(
          scan_id,project_id,path,language,lines_of_code,risk,risk_probability,
          estimated_refactor_hours,technical_debt_ratio
        ) values (
          v_scan_id,v_project,v_module_paths[v_i],'TypeScript',
          350 + (v_i * 260) + (v_scan.days_ago * 25),
          case when v_i <= 2 then 'low'::public.module_risk
               when v_i <= 4 then 'medium'::public.module_risk
               else 'high'::public.module_risk end,
          case when v_i <= 2 then 18 + (v_i * 5)
               when v_i <= 4 then 42 + (v_i * 7)
               else 82 end,
          case when v_i <= 2 then 2 + v_i
               when v_i <= 4 then 6 + v_i
               else 18 end,
          case when v_i <= 2 then 4 + v_i
               when v_i <= 4 then 10 + v_i
               else 26 end
        ) returning id into v_module_id;

        -- Representative per-module measurements for the detail drawer.
        insert into public.metrics(scan_id,module_id,metric_key,raw_value,normalized_score,weight,contribution)
        values
          (v_scan_id,v_module_id,'lines_of_code',350 + (v_i * 260),round(100 - ((350 + (v_i * 260))::numeric / 5000 * 100),2),0.04,round((100 - ((350 + (v_i * 260))::numeric / 5000 * 100)) * 0.04,4)),
          (v_scan_id,v_module_id,'cyclomatic_complexity',2 + (v_i * 2),round(100 - ((2 + (v_i * 2))::numeric / 20 * 100),2),0.12,round((100 - ((2 + (v_i * 2))::numeric / 20 * 100)) * 0.12,4)),
          (v_scan_id,v_module_id,'maintainability_index',92 - (v_i * 7),92 - (v_i * 7),0.14,round((92 - (v_i * 7)) * 0.14,4)),
          (v_scan_id,v_module_id,'code_smells',v_i,round(100 - (v_i::numeric / 35 * 100),2),0.10,round((100 - (v_i::numeric / 35 * 100)) * 0.10,4)),
          (v_scan_id,v_module_id,'comment_ratio',5 + (v_i * 2),round((5 + (v_i * 2))::numeric / 20 * 100,2),0.04,round(((5 + (v_i * 2))::numeric / 20 * 100) * 0.04,4)),
          (v_scan_id,v_module_id,'function_length',10 + (v_i * 8),round(100 - ((10 + (v_i * 8))::numeric / 100 * 100),2),0.08,round((100 - ((10 + (v_i * 8))::numeric / 100 * 100)) * 0.08,4)),
          (v_scan_id,v_module_id,'nesting_depth',v_i,round(100 - (v_i::numeric / 10 * 100),2),0.08,round((100 - (v_i::numeric / 10 * 100)) * 0.08,4)),
          (v_scan_id,v_module_id,'test_coverage_pct',95 - (v_i * 8),95 - (v_i * 8),0.12,round((95 - (v_i * 8)) * 0.12,4));
      end loop;

      for v_i in 1..12 loop
        insert into public.metrics(
          scan_id,module_id,metric_key,raw_value,normalized_score,weight,contribution
        ) values (
          v_scan_id,null,v_metric_keys[v_i],v_raw_values[v_i],
          v_norm_values[v_i],v_weights[v_i],
          round(v_norm_values[v_i] * v_weights[v_i],4)
        );
      end loop;
    end if;
  end loop;
end;
$seed$;
