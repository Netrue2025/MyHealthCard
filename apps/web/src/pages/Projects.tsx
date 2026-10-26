import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  FolderKanban,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api, send } from "../api";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Status,
  fmtDate,
} from "../components";

type Project = {
  id: string;
  title: string;
  description?: string;
  status: "active" | "on_hold" | "completed";
  role: "owner" | "member";
  completedSections: number;
  totalSections: number;
  updatedAt: string;
};

const invalidateProjects = (
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) => {
  queryClient.invalidateQueries({ queryKey: ["projects"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["project", id] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
};

function ProjectForm({
  initial,
  submit,
  saving,
}: {
  initial?: Partial<Project>;
  submit: (body: Record<string, string>) => void;
  saving: boolean;
}) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(
      Object.fromEntries(new FormData(event.currentTarget)) as Record<
        string,
        string
      >,
    );
  };
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field">
        <span>Project name</span>
        <input
          name="title"
          defaultValue={initial?.title}
          required
          minLength={2}
          maxLength={140}
          placeholder="e.g. My wellness plan"
        />
      </label>
      <label className="field">
        <span>
          Overview <small>(optional)</small>
        </span>
        <textarea
          name="description"
          defaultValue={initial?.description}
          maxLength={2000}
          rows={4}
          placeholder="What would you like to accomplish?"
        />
      </label>
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue={initial?.status ?? "active"}>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      <div className="modal-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save project"}
        </Button>
      </div>
    </form>
  );
}

function ProjectList() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ items: Project[] }>("/v1/projects"),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, string>) =>
      send("POST", "/v1/projects", body),
    onSuccess: () => {
      invalidateProjects(queryClient);
      setCreating(false);
    },
  });
  if (projects.isLoading) return <Loading />;
  if (projects.error)
    return (
      <ErrorState
        message={(projects.error as Error).message}
        retry={() => projects.refetch()}
      />
    );
  return (
    <div className="page projects-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Long-term plans</span>
          <h1>Projects</h1>
          <p>Keep a shared plan, step by step.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus /> New project
        </Button>
      </header>
      {!projects.data?.items.length ? (
        <Empty
          icon={<FolderKanban />}
          heading="Start a project"
          body="Create a plan, add sections, and track each step as you complete it."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create project
            </Button>
          }
        />
      ) : (
        <div className="project-grid">
          {projects.data.items.map((project) => {
            const percent = project.totalSections
              ? Math.round(
                  (project.completedSections / project.totalSections) * 100,
                )
              : 0;
            return (
              <button
                className="project-card"
                key={project.id}
                onClick={() => nav(`/projects/${project.id}`)}
              >
                <span className="project-card-icon">
                  <FolderKanban />
                </span>
                <div className="project-card-title">
                  <strong>{project.title}</strong>
                  <Status
                    kind={
                      project.status === "active"
                        ? "green"
                        : project.status === "on_hold"
                          ? "amber"
                          : "grey"
                    }
                    label={project.status.replace("_", " ")}
                  />
                </div>
                <p>{project.description || "No overview added yet."}</p>
                <div className="project-progress">
                  <span>
                    <b>{project.completedSections}</b> of{" "}
                    {project.totalSections} sections
                  </span>
                  <strong>{percent}%</strong>
                  <i>
                    <em style={{ width: `${percent}%` }} />
                  </i>
                </div>
                <footer>
                  <span>
                    {project.role === "owner"
                      ? "Owned by you"
                      : "Shared with you"}
                  </span>
                  <span>Updated {fmtDate(project.updatedAt)}</span>
                </footer>
              </button>
            );
          })}
        </div>
      )}
      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <ProjectForm
            submit={(body) => create.mutate(body)}
            saving={create.isPending}
          />
          {create.error && (
            <p className="form-error">{(create.error as Error).message}</p>
          )}
        </Modal>
      )}
    </div>
  );
}

function ProjectDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [sectionModal, setSectionModal] = useState(false);
  const [memberModal, setMemberModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/v1/projects/${id}`),
    enabled: Boolean(id),
  });
  const refresh = () => invalidateProjects(queryClient, id);
  const addSection = useMutation({
    mutationFn: (body: Record<string, string>) =>
      send("POST", `/v1/projects/${id}/sections`, body),
    onSuccess: () => {
      refresh();
      setSectionModal(false);
    },
  });
  const updateSection = useMutation({
    mutationFn: ({ section, body }: any) =>
      send("PATCH", `/v1/projects/${id}/sections/${section.id}`, body),
    onSuccess: refresh,
  });
  const deleteSection = useMutation({
    mutationFn: (sectionId: string) =>
      send("DELETE", `/v1/projects/${id}/sections/${sectionId}`),
    onSuccess: refresh,
  });
  const addMember = useMutation({
    mutationFn: (email: string) =>
      send("POST", `/v1/projects/${id}/members`, { email }),
    onSuccess: () => {
      refresh();
      setMemberModal(false);
    },
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      send("DELETE", `/v1/projects/${id}/members/${memberId}`),
    onSuccess: refresh,
  });
  const updateProject = useMutation({
    mutationFn: (body: Record<string, string>) =>
      send("PATCH", `/v1/projects/${id}`, body),
    onSuccess: () => {
      refresh();
      setEditModal(false);
    },
  });
  if (project.isLoading) return <Loading />;
  if (project.error)
    return (
      <ErrorState
        message={(project.error as Error).message}
        retry={() => project.refetch()}
      />
    );
  const data = project.data;
  const isOwner = data.role === "owner";
  const percent = data.project.totalSections
    ? Math.round(
        (data.project.completedSections / data.project.totalSections) * 100,
      )
    : 0;
  const toggle = (section: any) =>
    updateSection.mutate({
      section,
      body: {
        title: section.title,
        details: section.details,
        plannedDate: section.plannedDate,
        completed: !section.completed,
      },
    });
  return (
    <div className="page project-detail">
      <button className="back" onClick={() => nav("/projects")}>
        <ChevronLeft /> All projects
      </button>
      <section className="project-hero">
        <div>
          <span className="eyebrow">
            {isOwner ? "Your project" : "Shared project"}
          </span>
          <h1>{data.project.title}</h1>
          <p>
            {data.project.description ||
              "Add an overview to explain this project."}
          </p>
        </div>
        <div className="project-hero-actions">
          {isOwner && (
            <Button variant="secondary" onClick={() => setEditModal(true)}>
              <Pencil /> Edit
            </Button>
          )}
          <Button onClick={() => setSectionModal(true)}>
            <Plus /> Add section
          </Button>
        </div>
      </section>
      <section className="project-overview">
        <div>
          <strong>{percent}%</strong>
          <span>complete</span>
        </div>
        <div className="project-progress">
          <span>
            <b>{data.project.completedSections}</b> of{" "}
            {data.project.totalSections} sections done
          </span>
          <i>
            <em style={{ width: `${percent}%` }} />
          </i>
        </div>
        <Status
          kind={
            data.project.status === "active"
              ? "green"
              : data.project.status === "on_hold"
                ? "amber"
                : "grey"
          }
          label={data.project.status.replace("_", " ")}
        />
      </section>
      <div className="project-detail-grid">
        <section className="panel">
          <header>
            <div>
              <span className="eyebrow">Plan</span>
              <h2>Sections</h2>
            </div>
            <ListTodo />
          </header>
          {!data.sections.length ? (
            <Empty
              heading="Add the first section"
              body="Break this project into small, clear actions you can complete."
              action={
                <Button onClick={() => setSectionModal(true)}>
                  <Plus /> Add section
                </Button>
              }
            />
          ) : (
            <div className="section-list">
              {data.sections.map((section: any) => (
                <article
                  key={section.id}
                  className={section.completed ? "completed" : ""}
                >
                  <button
                    className="section-toggle"
                    onClick={() => toggle(section)}
                    disabled={updateSection.isPending}
                    aria-label={
                      section.completed ? "Mark incomplete" : "Mark complete"
                    }
                  >
                    {section.completed ? <CheckCircle2 /> : <span />}
                  </button>
                  <div>
                    <strong>{section.title}</strong>
                    {section.details && <p>{section.details}</p>}
                    {section.plannedDate && (
                      <small>Planned for {fmtDate(section.plannedDate)}</small>
                    )}
                  </div>
                  <button
                    className="quiet-delete"
                    onClick={() =>
                      window.confirm(`Delete “${section.title}”?`) &&
                      deleteSection.mutate(section.id)
                    }
                    aria-label={`Delete ${section.title}`}
                  >
                    <Trash2 />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="panel project-members">
          <header>
            <div>
              <span className="eyebrow">People</span>
              <h2>Project members</h2>
            </div>
            {isOwner && (
              <Button variant="secondary" onClick={() => setMemberModal(true)}>
                <UserPlus /> Add
              </Button>
            )}
          </header>
          <p className="project-members-note">
            Members can view and update project sections. Only the owner can
            manage access.
          </p>
          <div className="member-list">
            <article>
              <span>
                <UsersRound />
              </span>
              <div>
                <strong>{data.project.ownerName || "Project owner"}</strong>
                <small>Owner</small>
              </div>
            </article>
            {data.members.map((member: any) => (
              <article key={member.id}>
                <span>
                  <UsersRound />
                </span>
                <div>
                  <strong>{member.fullName || member.email}</strong>
                  <small>{member.email}</small>
                </div>
                {isOwner && (
                  <button
                    className="quiet-delete"
                    onClick={() =>
                      window.confirm(
                        `Remove ${member.email} from this project?`,
                      ) && removeMember.mutate(member.id)
                    }
                    aria-label={`Remove ${member.email}`}
                  >
                    <Trash2 />
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
      {sectionModal && (
        <Modal
          title="Add project section"
          onClose={() => setSectionModal(false)}
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              addSection.mutate(
                Object.fromEntries(new FormData(event.currentTarget)) as Record<
                  string,
                  string
                >,
              );
            }}
          >
            <label className="field">
              <span>Section</span>
              <input
                name="title"
                required
                maxLength={180}
                placeholder="e.g. Complete first check-in"
              />
            </label>
            <label className="field">
              <span>
                Details <small>(optional)</small>
              </span>
              <textarea
                name="details"
                rows={3}
                maxLength={2000}
                placeholder="Helpful notes for this section"
              />
            </label>
            <label className="field">
              <span>
                Planned date <small>(optional)</small>
              </span>
              <input type="date" name="plannedDate" />
            </label>
            <div className="modal-actions">
              <Button type="submit" disabled={addSection.isPending}>
                {addSection.isPending ? "Adding…" : "Add section"}
              </Button>
            </div>
          </form>
          {addSection.error && (
            <p className="form-error">{(addSection.error as Error).message}</p>
          )}
        </Modal>
      )}
      {memberModal && (
        <Modal
          title="Add a project member"
          onClose={() => setMemberModal(false)}
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              addMember.mutate(
                String(new FormData(event.currentTarget).get("email")),
              );
            }}
          >
            <p className="project-members-note">
              Invite someone with an existing Netrue account. They can update
              sections but cannot manage project access.
            </p>
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                required
                placeholder="name@example.com"
              />
            </label>
            <div className="modal-actions">
              <Button type="submit" disabled={addMember.isPending}>
                {addMember.isPending ? "Adding…" : "Add member"}
              </Button>
            </div>
          </form>
          {addMember.error && (
            <p className="form-error">{(addMember.error as Error).message}</p>
          )}
        </Modal>
      )}
      {editModal && (
        <Modal title="Edit project" onClose={() => setEditModal(false)}>
          <ProjectForm
            initial={data.project}
            submit={(body) => updateProject.mutate(body)}
            saving={updateProject.isPending}
          />
          {updateProject.error && (
            <p className="form-error">
              {(updateProject.error as Error).message}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function Projects() {
  const { id } = useParams();
  return id ? <ProjectDetail /> : <ProjectList />;
}
