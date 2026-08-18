#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "fileutils"
require "optparse"
require "pathname"
require "tempfile"
require "tmpdir"
require "time"
require "yaml"
require_relative "okf-validate"

MIGRATION_ACTOR = "process:agent-vault-okf-v0.2-upgrade"
LIFECYCLE = %w[draft stable deprecated].freeze

def parse_document(path)
  content = File.read(path, encoding: "UTF-8")
  return [nil, content] unless content.start_with?("---\n") || content.start_with?("---\r\n")

  lines = content.lines
  closing = lines.each_index.drop(1).find { |index| lines[index].match?(/\A---\s*\r?\n?\z/) }
  raise "#{path}: frontmatter has no closing delimiter" unless closing

  yaml = lines[1...closing].join
  frontmatter = YAML.safe_load(yaml, permitted_classes: [Date, Time], aliases: false)
  raise "#{path}: frontmatter must be a YAML mapping" unless frontmatter.is_a?(Hash)

  [frontmatter, lines[(closing + 1)..].join]
rescue Psych::Exception => error
  raise "#{path}: invalid YAML frontmatter (#{error.message.lines.first.strip})"
end

def render_document(frontmatter, body)
  yaml = YAML.dump(frontmatter).sub(/\A---\s*\n/, "")
  "---\n#{yaml}---\n#{body}"
end

def inferred_type(relative)
  value = relative.to_s
  return "project" if value == "README.md"
  return "task" if value.start_with?("tasks/")
  return "note" if value.start_with?("knowledge/")
  return "decision" if value.start_with?("docs/decisions/")
  return "doc" if value.start_with?("docs/")
  return "journal" if value.start_with?("journal/")
  return "handoff" if value.start_with?("handoffs/")

  nil
end

def normalize_datetime(value)
  return value.iso8601 if value.is_a?(Time)
  return "#{value.iso8601}T00:00:00Z" if value.is_a?(Date)

  text = value.to_s
  return Time.iso8601(text).iso8601 if text.match?(/T/)

  "#{Date.iso8601(text).iso8601}T00:00:00Z"
rescue ArgumentError, Date::Error
  raise "cannot migrate timestamp #{value.inspect}; expected ISO 8601"
end

def migrate_timestamp(frontmatter)
  return unless frontmatter.key?("timestamp")

  generated = frontmatter["generated"]
  if frontmatter.key?("generated") && !generated.is_a?(Hash)
    raise "refusing to overwrite existing generated value; expected a mapping"
  end
  generated ||= {}
  generated["by"] ||= MIGRATION_ACTOR
  generated["at"] ||= normalize_datetime(frontmatter["timestamp"])
  frontmatter["generated"] = generated
  frontmatter.delete("timestamp")
end

def migrate_workflow_status(frontmatter)
  type = frontmatter["type"]
  value = frontmatter["status"]

  if type == "decision" && !frontmatter.key?("decision_status")
    case value
    when "proposed"
      frontmatter["status"] = "draft"
      frontmatter["decision_status"] = "proposed"
    when "accepted"
      frontmatter["status"] = "stable"
      frontmatter["decision_status"] = "accepted"
    when "rejected"
      frontmatter["status"] = "deprecated"
      frontmatter["decision_status"] = "rejected"
    when /\Asuperseded(?: by .+)?\z/
      frontmatter["status"] = "deprecated"
      frontmatter["decision_status"] = value
    end
  elsif type == "handoff" && !frontmatter.key?("handoff_status")
    case value
    when "spent"
      frontmatter["status"] = "deprecated"
      frontmatter["handoff_status"] = "spent"
    when "live", nil
      frontmatter["status"] = "stable"
      frontmatter["handoff_status"] = "live"
    end
  elsif type == "task" && value == "blocked" && !frontmatter.key?("task_status")
    frontmatter["status"] = "stable"
    frontmatter["task_status"] = "blocked"
  end

  value = frontmatter["status"]
  if value && !LIFECYCLE.include?(value)
    raise "unrecognized workflow status #{value.inspect} for type #{type.inspect}"
  end
  frontmatter["status"] ||= "stable"
end

def migrate_concept(root, path)
  relative = path.relative_path_from(root)
  frontmatter, body = parse_document(path)
  type = inferred_type(relative)

  if frontmatter.nil?
    raise "#{relative}: cannot infer a type for missing frontmatter" unless type

    title = relative.to_s == "README.md" ? root.basename.to_s : relative.basename(".md").to_s.tr("-", " ")
    frontmatter = {
      "type" => type,
      "title" => title,
      "status" => "stable",
      "generated" => { "by" => MIGRATION_ACTOR, "at" => Time.now.utc.iso8601 }
    }
  elsif !frontmatter["type"].is_a?(String) || frontmatter["type"].strip.empty?
    raise "#{relative}: missing type and no safe automatic repair" unless type

    frontmatter["type"] = type
  end

  migrate_timestamp(frontmatter)
  migrate_workflow_status(frontmatter)
  render_document(frontmatter, body)
end

def migrate_root_index(root)
  path = root.join("index.md")
  raise "index.md: agent-vault v0.2 profile requires a bundle-root index" unless path.file?

  frontmatter, body = parse_document(path)
  frontmatter ||= {}
  extra = frontmatter.keys - ["okf_version"]
  raise "index.md: cannot preserve unsupported root-index keys: #{extra.join(", ")}" unless extra.empty?

  frontmatter["okf_version"] = "0.2"
  render_document(frontmatter, body)
end

def atomic_write(path, content)
  mode = path.stat.mode & 0o777
  temp = Tempfile.new([".okf-upgrade-", ".md"], path.dirname.to_s)
  temp.write(content)
  temp.flush
  File.chmod(mode, temp.path)
  temp.close
  File.rename(temp.path, path)
ensure
  temp&.unlink
end

options = { write: false }
parser = OptionParser.new do |opts|
  opts.banner = "usage: okf-upgrade-v0.2.rb [--write] <bundle-path>"
  opts.on("--write", "apply the validated upgrade (default: dry run)") { options[:write] = true }
end
parser.parse!
root_arg = ARGV.shift
abort parser.to_s unless root_arg && ARGV.empty?

root = Pathname(root_arg).expand_path
abort "#{root}: bundle directory does not exist" unless root.directory?

changes = { Pathname("index.md") => migrate_root_index(root) }
Dir.glob(root.join("**", "*.md"), File::FNM_DOTMATCH).sort.each do |name|
  path = Pathname(name)
  relative = path.relative_path_from(root)
  next if %w[index.md log.md].include?(path.basename.to_s)

  changes[relative] = migrate_concept(root, path)
end
changes.select! { |relative, content| File.read(root.join(relative), encoding: "UTF-8") != content }

Dir.mktmpdir("agent-vault-okf-upgrade-") do |temporary|
  FileUtils.cp_r(root.children.map(&:to_s), temporary) unless root.children.empty?
  changes.each do |relative, content|
    target = Pathname(temporary).join(relative)
    FileUtils.mkdir_p(target.dirname)
    File.write(target, content)
  end
  validator = OkfValidator.new(root: temporary, required_version: "0.2", strict: true)
  unless validator.validate
    validator.report
    abort "upgrade aborted: transformed bundle did not pass the agent-vault strict v0.2 profile"
  end
end

if options[:write]
  originals = {}
  changes.each_key { |relative| originals[relative] = File.binread(root.join(relative)) }
  written = []
  begin
    changes.each do |relative, content|
      atomic_write(root.join(relative), content)
      written << relative
    end
  rescue StandardError => error
    written.reverse_each { |relative| atomic_write(root.join(relative), originals.fetch(relative)) }
    abort "upgrade rolled back after write failure: #{error.message}"
  end
  puts "upgraded OKF v0.2 bundle: #{changes.length} file(s) changed"
else
  puts "dry run: #{changes.length} file(s) would change"
  changes.each_key { |relative| puts "- #{relative}" }
  puts "re-run with --write to apply"
end
