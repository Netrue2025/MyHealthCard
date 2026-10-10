import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  Check,
  Clock3,
  FlaskConical,
  Pencil,
  Pill,
  Plus,
  Trash2,
} from "lucide-react";
import { api, send } from "../api";
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  SelectField,
  fmtDate,
} from "../components";
import PublicShareButton from "../PublicShareButton";

const today = () => new Date().toISOString().slice(0, 10);
function keyToBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
export default function DailyCare() {
  const qc = useQueryClient();
  const [medModal, setMedModal] = useState(false),
    [testModal, setTestModal] = useState(false),
    [selectedTest, setSelectedTest] = useState<any>(null),
    [editingTest, setEditingTest] = useState<any>(null),
    [notice, setNotice] = useState("");
  const meds = useQuery({
    queryKey: ["medications"],
    queryFn: () => api<any>("/v1/medications"),
  });
  const tests = useQuery({
    queryKey: ["daily-tests"],
    queryFn: () => api<any>("/v1/daily-tests"),
  });
  const addMed = useMutation({
    mutationFn: (body: any) => send("POST", "/v1/medications", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medications"] });
      setMedModal(false);
    },
  });
  const log = useMutation({
    mutationFn: ({ id, time }: { id: string; time: string }) =>
      send("POST", `/v1/medications/${id}/log`, {
        scheduledDate: today(),
        time,
        status: "taken",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["medications"] }),
  });
  const removeMed = useMutation({
    mutationFn: (id: string) => send("DELETE", `/v1/medications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["medications"] }),
  });
  const addTest = useMutation({
    mutationFn: (body: any) => send("POST", "/v1/daily-tests", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-tests"] });
      setTestModal(false);
    },
  });
  const updateTest = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      send("PATCH", `/v1/daily-tests/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-tests"] });
      setTestModal(false);
      setEditingTest(null);
      setSelectedTest(null);
    },
  });
  const deleteTest = useMutation({
    mutationFn: (id: string) => send("DELETE", `/v1/daily-tests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-tests"] });
      setSelectedTest(null);
    },
  });
  async function enablePush() {
    setNotice("");
    try {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error("Push notifications are not supported on this device.");
      const config = await api<any>("/v1/push/config");
      if (!config.enabled)
        throw new Error(
          "Push reminders need VAPID keys configured on the server.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(config.publicKey),
      });
      await send("POST", "/v1/push/subscriptions", {
        subscription: subscription.toJSON(),
      });
      setNotice("Notifications are enabled on this device.");
    } catch (error: any) {
      setNotice(error.message);
    }
  }
  function submitMed(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    addMed.mutate({
      name: data.get("name"),
      dose: data.get("dose"),
      instructions: data.get("instructions") || undefined,
      times: [String(data.get("time"))],
      repeatDaily: true,
      reminderEnabled: data.get("reminderEnabled") === "on",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      startDate: today(),
    });
  }
  function submitTest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      ...data,
      measuredAt: editingTest?.measuredAt ?? new Date().toISOString(),
    };
    if (editingTest) updateTest.mutate({ id: editingTest.id, body });
    else addTest.mutate(body);
  }
  const taken = (id: string, time: string) =>
    meds.data?.logs?.some(
      (x: any) =>
        x.scheduleId === id && x.time === time && x.status === "taken",
    );
  return (
    <div className="page daily-care">
      <header className="page-header">
        <div>
          <span className="eyebrow">Today's routine</span>
          <h1>Daily care</h1>
          <p>Medicines, reminders and daily readings.</p>
        </div>
        <div className="daily-head-actions">
          <PublicShareButton kind="daily_logs" />
          <Button variant="secondary" onClick={enablePush}>
            <BellRing /> Enable alerts
          </Button>
        </div>
      </header>
      {notice && (
        <p className="notification-note">
          <Bell /> {notice}
        </p>
      )}
      <div className="care-columns">
        <section className="panel">
          <header>
            <div>
              <span className="eyebrow">Medication</span>
              <h2>Today's doses</h2>
            </div>
            <Button onClick={() => setMedModal(true)}>
              <Plus /> Add
            </Button>
          </header>
          {meds.isLoading ? (
            <Loading />
          ) : meds.error ? (
            <ErrorState message={(meds.error as Error).message} />
          ) : !meds.data.items.length ? (
            <Empty
              icon={<Pill />}
              heading="No medicines yet"
              body="Add a medicine and choose its daily reminder time."
            />
          ) : (
            <div className="routine-list">
              {meds.data.items.flatMap((m: any) =>
                m.times.map((time: string) => (
                  <article key={`${m.id}-${time}`}>
                    <span className="routine-icon">
                      <Pill />
                    </span>
                    <div>
                      <strong>{m.name}</strong>
                      <small>
                        {m.dose} · {time}
                        {m.reminderEnabled ? " · Alert on" : ""}
                      </small>
                    </div>
                    <button
                      className={
                        taken(m.id, time) ? "dose-done" : "dose-button"
                      }
                      disabled={taken(m.id, time)}
                      onClick={() => log.mutate({ id: m.id, time })}
                    >
                      <Check /> {taken(m.id, time) ? "Taken" : "Take"}
                    </button>
                    <button
                      className="quiet-delete"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => removeMed.mutate(m.id)}
                    >
                      <Trash2 />
                    </button>
                  </article>
                )),
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <header>
            <div>
              <span className="eyebrow">Daily tests</span>
              <h2>Recent readings</h2>
            </div>
            <Button
              onClick={() => {
                setEditingTest(null);
                setTestModal(true);
              }}
            >
              <Plus /> Add
            </Button>
          </header>
          {tests.isLoading ? (
            <Loading />
          ) : tests.error ? (
            <ErrorState message={(tests.error as Error).message} />
          ) : !tests.data.items.length ? (
            <Empty
              icon={<FlaskConical />}
              heading="No readings yet"
              body="Record blood pressure, glucose, temperature and more."
            />
          ) : (
            <div className="test-list">
              {tests.data.items.map((t: any) => (
                <button
                  className="test-entry"
                  key={t.id}
                  onClick={() => setSelectedTest(t)}
                >
                  <span>
                    <FlaskConical />
                  </span>
                  <div>
                    <strong>{t.testType.replaceAll("_", " ")}</strong>
                    <small>{fmtDate(t.measuredAt)}</small>
                  </div>
                  <b>
                    {t.value} {t.unit}
                  </b>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {medModal && (
        <Modal title="Add medication" onClose={() => setMedModal(false)}>
          <form className="modal-form" onSubmit={submitMed}>
            <Field
              label="Medication"
              name="name"
              placeholder="Medicine name"
              required
            />
            <Field
              label="Dose"
              name="dose"
              placeholder="e.g. 1 tablet"
              required
            />
            <Field label="Daily time" name="time" type="time" required />
            <Field
              label="Instructions"
              name="instructions"
              placeholder="e.g. Take after food"
            />
            <label className="check-row">
              <input type="checkbox" name="reminderEnabled" defaultChecked />
              <Bell /> Send a daily reminder
            </label>
            {addMed.error && (
              <p className="form-error">{(addMed.error as Error).message}</p>
            )}
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMedModal(false)}
              >
                Cancel
              </Button>
              <Button disabled={addMed.isPending}>Save</Button>
            </div>
          </form>
        </Modal>
      )}
      {selectedTest && (
        <Modal title="Test details" onClose={() => setSelectedTest(null)}>
          <div className="test-detail-modal">
            <span className="test-detail-icon">
              <FlaskConical />
            </span>
            <span className="eyebrow">
              {selectedTest.testType.replaceAll("_", " ")}
            </span>
            <strong className="test-detail-value">
              {selectedTest.value} {selectedTest.unit}
            </strong>
            <dl>
              <div>
                <dt>Recorded</dt>
                <dd>{fmtDate(selectedTest.measuredAt)}</dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>{selectedTest.notes || "No note added"}</dd>
              </div>
            </dl>
            <div className="modal-actions test-detail-actions">
              <Button
                variant="danger"
                disabled={deleteTest.isPending}
                onClick={() =>
                  confirm("Delete this daily test record?") &&
                  deleteTest.mutate(selectedTest.id)
                }
              >
                <Trash2 /> Delete
              </Button>
              <Button
                onClick={() => {
                  setEditingTest(selectedTest);
                  setSelectedTest(null);
                  setTestModal(true);
                }}
              >
                <Pencil /> Edit
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {testModal && (
        <Modal
          title={editingTest ? "Edit daily reading" : "Add daily reading"}
          onClose={() => {
            setTestModal(false);
            setEditingTest(null);
          }}
        >
          <form className="modal-form" onSubmit={submitTest}>
            <SelectField
              label="Test"
              name="testType"
              defaultValue={editingTest?.testType}
            >
              <option value="blood_pressure">Blood pressure</option>
              <option value="blood_sugar">Blood sugar</option>
              <option value="temperature">Temperature</option>
              <option value="weight">Weight</option>
              <option value="oxygen_saturation">Oxygen saturation</option>
              <option value="other">Other</option>
            </SelectField>
            <Field
              label="Result"
              name="value"
              placeholder="e.g. 120/80"
              defaultValue={editingTest?.value}
              required
            />
            <Field
              label="Unit"
              name="unit"
              placeholder="e.g. mmHg"
              defaultValue={editingTest?.unit}
            />
            <Field
              label="Notes"
              name="notes"
              placeholder="Optional note"
              defaultValue={editingTest?.notes}
            />
            {(addTest.error || updateTest.error) && (
              <p className="form-error">
                {((addTest.error || updateTest.error) as Error).message}
              </p>
            )}
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setTestModal(false);
                  setEditingTest(null);
                }}
              >
                Cancel
              </Button>
              <Button disabled={addTest.isPending || updateTest.isPending}>
                {editingTest ? "Save changes" : "Save reading"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
